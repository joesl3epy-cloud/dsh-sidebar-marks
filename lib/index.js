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

const sseClients = new Set();

export const name = 'dsh-sidebar-marks';
export const inject = [];

const PORTS = [49397, 49398, 49399, 49400, 49401, 49402, 49403, 49404, 49405];
const DSH_HOME = path.join(os.homedir(), '.dsh');
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

/** 读标记文件，返回 { sessionId: { marks: [], tags: [] } } */
function readMarks(file) {
	const target = file || ANNOTATIONS;
	let raw;
	try {
		raw = fs.readFileSync(target, 'utf8');
	} catch {
		return { ok: true, installed: false, sessions: {} };
	}
	let data;
	try {
		data = JSON.parse(raw);
	} catch {
		return { ok: true, installed: true, error: 'bad-json', sessions: {} };
	}
	const out = {};
	const sessions = (data && data.sessions) || {};
	for (const id of Object.keys(sessions)) {
		const a = sessions[id] || {};
		const marks = [];
		if (a.reviewLater === true) marks.push('later');
		if (a.favorite === true) marks.push('favorite');
		if (Array.isArray(a.tags) && a.tags.length > 0) marks.push('tag');
		if (marks.length === 0) continue;
		out[id] = { marks, tags: a.tags || [], priority: typeof a.priority === 'number' ? a.priority : null };
	}
	return { ok: true, installed: true, sessions: out };
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

function handle(req, res, rawUrl, body) {
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
		return send(res, 200, { ok: true, plugin: name, version: '0.9.0', ui, sessionManager: sessionManagerInstalled() });
	}

	if (req.method === 'GET' && route === '/style') {
		return send(res, 200, { ok: true, style: readStyle() });
	}

	if (req.method === 'GET' && route === '/marks') {
		return send(res, 200, readMarks());
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
export const __test = { readMarks, readStyle, sessionManagerInstalled };

export function apply(ctx) {
	log('plugin applied');
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
