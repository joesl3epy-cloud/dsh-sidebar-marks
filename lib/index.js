/**
 * dsh-sidebar-marks — 主控侧（host half）。
 *
 * 职责：
 *   1. 读 dsh-session-manager 的标记文件 annotations.v1.json
 *   2. 在本机回环起一个小端口，把标记发给前端 / 接收前端探针
 *
 * 端口：49397（被占用则依次尝试 49398-49405）。
 * 日志：~/.dsh/dsh-sidebar-marks/host.log
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const sseClients = new Set();

export const name = 'dsh-sidebar-marks';
export const inject = [];

const PORTS = [49397, 49398, 49399, 49400, 49401, 49402, 49403, 49404, 49405];
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const ANNOTATIONS = path.join(DSH_HOME, 'dsh-session-manager', 'annotations.v1.json');
const LOG_DIR = path.join(DSH_HOME, 'dsh-sidebar-marks');
const LOG_FILE = path.join(LOG_DIR, 'host.log');
const UI_STAMP = path.join(LOG_DIR, 'ui.stamp');

function log(line) {
	try {
		fs.mkdirSync(LOG_DIR, { recursive: true });
		fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
	} catch {
		/* 日志失败不影响主流程 */
	}
}

const MARKS_FILE = path.join(LOG_DIR, 'marks.json');
const SESSIONS_DIR = path.join(DSH_HOME, 'sessions');
const TRASH_DIR = path.join(SESSIONS_DIR, '.trash');
const SID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{3,120}$/;

function parseMarksFile(file) {
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch {
		return { sessions: {}, error: null };
	}
	try {
		const data = JSON.parse(text);
		return { sessions: (data && data.sessions) || {}, error: null };
	} catch {
		return { sessions: {}, error: 'bad-json' };
	}
}

/**
 * 合并两个来源：
 *   - 我们自己的 marks.json（可写，用户在这里打标记）
 *   - dsh-session-manager 的 annotations.v1.json（只读，装了它就读它的）
 * 同一会话按「或」合并：任一来源标了就算标了，标签取并集。
 */
function readMarks(ownFile, sharedFile) {
	const ownPath = ownFile || MARKS_FILE;
	const sharedPath = sharedFile || ANNOTATIONS;
	const own = parseMarksFile(ownPath);
	const shared = parseMarksFile(sharedPath);
	const installed = fs.existsSync(ownPath) || fs.existsSync(sharedPath);
	const out = {};
	const ids = new Set(Object.keys(own.sessions).concat(Object.keys(shared.sessions)));
	for (const id of ids) {
		const a = own.sessions[id] || {};
		const b = shared.sessions[id] || {};
		const later = a.reviewLater === true || b.reviewLater === true;
		const favorite = a.favorite === true || b.favorite === true;
		const tags = Array.from(new Set([].concat(a.tags || [], b.tags || []))).filter(Boolean);
		const marks = [];
		if (later) marks.push('later');
		if (favorite) marks.push('favorite');
		if (tags.length > 0) marks.push('tag');
		if (marks.length === 0) continue;
		out[id] = { marks, tags, reviewLater: later, favorite, priority: typeof a.priority === 'number' ? a.priority : null };
	}
	const r = { ok: true, installed, sessions: out };
	if (own.error) r.error = own.error;
	else if (shared.error) r.error = shared.error;
	return r;
}

function writeJsonAtomic(file, data) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = file + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
	fs.renameSync(tmp, file);
}

/** 改一条会话的标记。只写我们自己的文件，不碰 session-manager 的数据。 */
function applyMark(payload, file) {
	const target = file || MARKS_FILE;
	const id = String((payload && payload.sessionId) || '');
	if (!id) return { ok: false, error: 'missing-sessionId' };
	let data = {};
	try { data = JSON.parse(fs.readFileSync(target, 'utf8')) || {}; } catch { data = {}; }
	if (!data.sessions || typeof data.sessions !== 'object') data.sessions = {};
	const cur = data.sessions[id] || {};
	if (payload.clear === true) {
		delete data.sessions[id];
	} else {
		if (typeof payload.reviewLater === 'boolean') cur.reviewLater = payload.reviewLater;
		if (typeof payload.favorite === 'boolean') cur.favorite = payload.favorite;
		if (Array.isArray(payload.tags)) {
			cur.tags = payload.tags.map((x) => String(x)).filter(Boolean).slice(0, 12);
		}
		const empty = cur.reviewLater !== true && cur.favorite !== true
			&& !(Array.isArray(cur.tags) && cur.tags.length > 0);
		if (empty) delete data.sessions[id];
		else {
			cur.updatedAt = new Date().toISOString();
			data.sessions[id] = cur;
		}
	}
	data.version = 1;
	writeJsonAtomic(target, data);
	broadcastChanged();
	return { ok: true, sessionId: id, session: readMarks(target, target).sessions[id] || null };
}

const STYLE_FILE = path.join(os.homedir(), '.dsh', 'dsh-sidebar-marks', 'style.json');

// 视觉参数：改这个文件即可，前端 5 秒内自动应用，不用重启 DSH
const DEFAULT_STYLE = {
	// 显示模式：all = 有几个标就画几个点；single = 只画优先级最高的那一个
	displayMode: 'all',
	// single 模式下的优先级，从高到低。可用值：later（待回看）/ favorite（收藏）/ tag（标签）
	priority: ['later', 'favorite', 'tag'],
	dotSize: 6,
	dotTop: -1.5,
	dotGap: 7,
	dotOpacity: 1,
	dotGroupSize: 6,
	dotGroupOpenSize: 3,
	colorLater: '#ec7a70',
	colorFavorite: '#d9a94e',
	colorTag: '#8fb8d9',
	// 标签多色：按标签名哈希取色，同一标签永远同一个颜色
	tagPalette: [
		'#7aa7d9',
		'#6ec2b8',
		'#a98fd6',
		'#9fbf6f',
		'#c99ac4',
		'#c9a06a',
		'#8fa8c4',
		'#d98fb0',
	],
};

function readStyle(file) {
	const target = file || STYLE_FILE;
	try {
		const user = JSON.parse(fs.readFileSync(target, 'utf8'));
		return Object.assign({}, DEFAULT_STYLE, user || {});
	} catch {
		return DEFAULT_STYLE;
	}
}

const STYLE_NUM_KEYS = ['dotSize', 'dotTop', 'dotGap', 'dotOpacity', 'dotGroupSize', 'dotGroupOpenSize'];
const STYLE_COLOR_KEYS = ['colorLater', 'colorFavorite', 'colorTag'];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** 改外观参数：只认白名单键，坏值直接忽略，不整份拒绝。 */
function applyStylePatch(payload, file) {
	const target = file || STYLE_FILE;
	const next = Object.assign({}, DEFAULT_STYLE, readStyle(target));
	if (payload && typeof payload === 'object') {
		for (const k of STYLE_NUM_KEYS) {
			if (typeof payload[k] === 'number' && Number.isFinite(payload[k])) next[k] = payload[k];
		}
		for (const k of STYLE_COLOR_KEYS) {
			if (typeof payload[k] === 'string' && HEX_RE.test(payload[k])) next[k] = payload[k];
		}
		if (payload.displayMode === 'all' || payload.displayMode === 'single') next.displayMode = payload.displayMode;
		if (Array.isArray(payload.priority) && payload.priority.length === 3) {
			const set = new Set(payload.priority);
			if (set.size === 3 && ['later', 'favorite', 'tag'].every((x) => set.has(x))) {
				next.priority = payload.priority.slice();
			}
		}
	}
	writeJsonAtomic(target, next);
	return { ok: true, style: next };
}


/** 从会话目录里读出头部那一行（zstd 流式解压，读到第一个换行就停）。 */
function readSessionHeader(dirPath) {
	let names = [];
	try {
		names = fs.readdirSync(dirPath);
	} catch {
		return Promise.resolve(null);
	}
	const zst = names.find((n) => /^session.*\.jsonl\.zstd$/.test(n));
	const plain = names.find((n) => /^session.*\.jsonl$/.test(n));
	const pick = zst || plain;
	if (!pick) return Promise.resolve(null);
	const full = path.join(dirPath, pick);

	const parse = (text) => {
		const nl = text.indexOf('\n');
		const line = nl >= 0 ? text.slice(0, nl) : text;
		try {
			return JSON.parse(line);
		} catch {
			return null;
		}
	};

	if (!zst) {
		return Promise.resolve().then(() => {
			try {
				return parse(fs.readFileSync(full, 'utf8'));
			} catch {
				return null;
			}
		});
	}

	return new Promise((resolve) => {
		let done = false;
		const chunks = [];
		const finish = (value) => {
			if (done) return;
			done = true;
			try { src.destroy(); } catch {}
			try { dec.destroy(); } catch {}
			resolve(value);
		};
		let src;
		let dec;
		try {
			src = fs.createReadStream(full, { highWaterMark: 65536 });
			dec = zlib.createZstdDecompress();
		} catch {
			return resolve(null);
		}
		dec.on('data', (chunk) => {
			chunks.push(chunk);
			const text = Buffer.concat(chunks).toString('utf8');
			if (text.indexOf('\n') >= 0) finish(parse(text));
		});
		dec.on('error', () => finish(null));
		dec.on('end', () => finish(parse(Buffer.concat(chunks).toString('utf8'))));
		src.on('error', () => finish(null));
		src.pipe(dec);
	});
}

/** 扫一遍所有工作区目录下的会话头。删东西之前要拿全量，才能判断有没有子 agent。 */
async function scanSessionHeaders() {
	const out = [];
	let workspaces = [];
	try {
		workspaces = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
			.filter((d) => d.isDirectory() && d.name !== '.trash');
	} catch {
		return out;
	}
	for (const w of workspaces) {
		const wdir = path.join(SESSIONS_DIR, w.name);
		let dirs = [];
		try {
			dirs = fs.readdirSync(wdir, { withFileTypes: true }).filter((d) => d.isDirectory());
		} catch {
			continue;
		}
		for (const d of dirs) {
			const dir = path.join(wdir, d.name);
			const header = await readSessionHeader(dir);
			if (header && header.id) out.push(Object.assign({}, header, { dir }));
		}
	}
	return out;
}

/**
 * 删一个会话：移进 sessions/.trash，不直接抹掉。
 * 保守规则：有子 agent 就拒绝，正在内存里跑着也拒绝。
 */
async function deleteSessionById(ctx, id) {
	if (!SID_RE.test(id)) return { ok: false, status: 400, error: 'bad-session-id' };

	const headers = await scanSessionHeaders();
	const target = headers.find((h) => h.id === id);
	if (!target) return { ok: false, status: 404, error: 'not-found' };

	const subs = headers.filter((h) => h.origin === 'subagent' && h.parentSession === id);
	if (subs.length > 0) {
		return { ok: false, status: 409, error: 'has-subagents', subagents: subs.map((s) => s.id) };
	}

	let live = null;
	try {
		live = ctx && ctx.sessions && typeof ctx.sessions.get === 'function' ? ctx.sessions.get(id) : null;
	} catch {}
	if (live) return { ok: false, status: 409, error: 'session-in-use' };

	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dest = path.join(TRASH_DIR, stamp, id);
	try {
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.renameSync(target.dir, dest);
	} catch (error) {
		return { ok: false, status: 500, error: 'move-failed', message: String((error && error.message) || error) };
	}

	try {
		applyMark({ sessionId: id, clear: true });
	} catch {}

	log(`delete session=${id} movedTo=${dest}`);
	return { ok: true, sessionId: id, movedTo: dest };
}

function send(res, status, body) {
	const text = JSON.stringify(body);
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'access-control-allow-origin': '*',
		'access-control-allow-headers': 'content-type',
		'access-control-allow-methods': 'GET,POST,OPTIONS',
		'cache-control': 'no-store',
	});
	res.end(text);
}

async function handle(req, res, rawUrl, body) {
	const route = String(rawUrl || '').split('?')[0];

	if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

	// SSE：标注文件一变就推给前端，不用轮询
	if (req.method === 'GET' && route === '/stream') {
		res.writeHead(200, {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'Access-Control-Allow-Origin': '*',
		});
		res.write('retry: 2000\n\n');
		const client = { res };
		sseClients.add(client);
		log('sse open clients=' + sseClients.size);
		const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
		const cleanup = () => {
			clearInterval(ping);
			sseClients.delete(client);
			log('sse close clients=' + sseClients.size);
		};
		// 注意：IncomingMessage 的 'close' 表示「请求体读完了」，GET 会立刻触发，
		// 之前绑在 req 上导致 SSE 一连上就被自己关掉（日志里 sse open/close 同毫秒）。
		// 连接真正断开要监听 ServerResponse 的 'close'。
		res.on('close', cleanup);
		res.on('error', cleanup);
		return;
	}

	if (req.method === 'GET' && route === '/health') {
		let ui = '1';
		try { ui = fs.readFileSync(UI_STAMP, 'utf8').trim() || '1'; } catch { /* 没有就默认 1 */ }
		// sessionManager 决定标记由谁产生：装了它，我们只负责显示
		return send(res, 200, { ok: true, plugin: name, version: '1.0.0', ui, sessionManager: sessionManagerInstalled() });
	}

	if (req.method === 'GET' && route === '/style') {
		return send(res, 200, { ok: true, style: readStyle() });
	}

	if (req.method === 'GET' && route === '/marks') {
		return send(res, 200, readMarks());
	}

	if (req.method === 'POST' && route === '/style') {
		let payload;
		try {
			payload = JSON.parse(body || '{}');
		} catch {
			return send(res, 400, { ok: false, error: 'bad-json' });
		}
		return send(res, 200, applyStylePatch(payload));
	}

	if (req.method === 'POST' && route === '/session-delete') {
		let payload;
		try {
			payload = JSON.parse(body || '{}');
		} catch {
			return send(res, 400, { ok: false, error: 'bad-json' });
		}
		const outcome = await deleteSessionById(pluginCtx, String((payload && payload.sessionId) || ''));
		return send(res, outcome.status || 200, outcome);
	}

	if (req.method === 'POST' && route === '/mark') {
		let payload;
		try {
			payload = JSON.parse(body || '{}');
		} catch {
			return send(res, 400, { ok: false, error: 'bad-json' });
		}
		const result = applyMark(payload);
		log(`mark sid=${payload && payload.sessionId ? String(payload.sessionId).slice(0, 20) : '?'} ok=${result.ok} `
			+ `keys=${Object.keys(payload || {}).filter((k) => k !== 'sessionId').join(',')}`);
		return send(res, 200, result);
	}

	return send(res, 404, { ok: false, error: 'not-found' });
}

// 当前活跃的 http server；热重载时要把旧的关掉，否则端口会一个个泄漏
let activeServer = null;

function startServer() {
	let index = 0;
	const tryListen = () => {
		const port = PORTS[index];
		if (port === undefined) {
			log('no free port, giving up');
			return;
		}
		const server = http.createServer((req, res) => {
			let body = '';
			req.on('data', (chunk) => {
				body += chunk;
				if (body.length > 200000) req.destroy();
			});
			req.on('end', () => handle(req, res, req.url, body));
		});
		server.once('error', (err) => {
			if (err && err.code === 'EADDRINUSE') {
				index += 1;
				tryListen();
			} else {
				log(`server error ${String(err && err.message)}`);
			}
		});
		server.listen(port, '127.0.0.1', () => {
			activeServer = server;
			log(`listening on 127.0.0.1:${port}`);
		});
	};
	tryListen();
}

function broadcastChanged() {
	let n = 0;
	for (const c of sseClients) {
		try { c.res.write('event: changed\ndata: {}\n\n'); n++; } catch (e) {}
	}
	if (n) log('broadcast changed -> ' + n);
}

// 盯住标注文件：任何写入都立刻通知前端
function watchAnnotations() {
	let timer = null;
	try {
		const w = fs.watch(ANNOTATIONS, { persistent: false }, () => {
			if (timer) return;
			timer = setTimeout(() => { timer = null; broadcastChanged(); }, 120);
		});
		return () => { try { w.close(); } catch (e) {} };
	} catch (e) {
		log('watch failed: ' + String(e && e.message));
		return () => {};
	}
}


/** 装了 dsh-session-manager 吗？决定要不要显示我们自己的标题栏按钮 */
function sessionManagerInstalled() {
	try {
		const profiles = path.join(DSH_HOME, 'profiles');
		for (const entry of fs.readdirSync(profiles)) {
			if (fs.existsSync(path.join(profiles, entry, 'node_modules', 'dsh-session-manager'))) return true;
		}
	} catch {
		/* 读不到就当作没装 */
	}
	return false;
}

// 供测试直接调用；DSH 只认 apply / inject / name，多导出不影响契约
export const __test = { readMarks, readStyle, applyMark, applyStylePatch, sessionManagerInstalled, deleteSessionById, scanSessionHeaders };

let pluginCtx = null;

export function apply(ctx) {
	log('plugin applied');
	pluginCtx = ctx;
	startServer();
	const stopWatch = watchAnnotations();
	if (ctx && typeof ctx.effect === 'function') {
		ctx.effect(() => () => {
			try { stopWatch(); } catch (e) {}
			for (const c of sseClients) { try { c.res.end(); } catch (e) {} }
			sseClients.clear();
			if (activeServer) {
				try { activeServer.close(); } catch (e) {}
				log('server closed');
				activeServer = null;
			}
			log('plugin disposed');
		}, 'sidebar-marks: host server');
	}
}
