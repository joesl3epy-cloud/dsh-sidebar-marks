import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildCatalog } from './catalog.mjs';

export const name = 'dsh-sidebar-marks';
export const inject = ['webServer', 'sessions', 'sessionPersistence', 'workspaceRegistry', 'sessionQuery'];
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
const API = '/sidebar-marks/api';
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const LOG_DIR = path.join(DSH_HOME,'dsh-sidebar-marks');
const LOG_FILE = path.join(LOG_DIR,'host.log');
const MARKS_FILE = path.join(LOG_DIR,'marks.json');
const ANNOTATIONS = path.join(DSH_HOME,'dsh-session-manager','annotations.v1.json');
const SESSIONS_DIR = path.join(DSH_HOME,'sessions');
const TRASH_DIR = path.join(SESSIONS_DIR,'.trash');
const SID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{3,120}$/;
function log(message) { try { fs.mkdirSync(LOG_DIR,{recursive:true}); fs.appendFileSync(LOG_FILE,new Date().toISOString()+' '+message+'\n'); } catch {} }
function parseMarksFile(file) {
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch {
		return { sessions: {}, error: null };
	}
	try {
		const data = JSON.parse(text);
		if (!data || typeof data.sessions !== 'object' || !data.sessions || Array.isArray(data.sessions)) return { sessions: {}, error: 'bad-json' };
        return { sessions: data.sessions, error: null };
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
		const overrides = a.overrides || {};
		const later = overrides.reviewLater ? a.reviewLater === true : a.reviewLater === true || b.reviewLater === true;
		const favorite = overrides.favorite ? a.favorite === true : a.favorite === true || b.favorite === true;
		const normalizeTags = xs => Array.isArray(xs) ? xs.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean) : [];
		const tags = [...new Set(normalizeTags(a.tags).concat(overrides.tags ? [] : normalizeTags(b.tags)))];
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
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
	fs.renameSync(tmp, file);
}

/** 改一条会话的标记。只写我们自己的文件，不碰 session-manager 的数据。 */
function applyMark(payload, file) {
	const target = file || MARKS_FILE;
	const id = String((payload && payload.sessionId) || '');
	if (!id) return { ok: false, error: 'missing-sessionId' };
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) return { ok: false, error: 'bad-sessionId' };
	let data = {};
	try { data = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (error) {
		if (error.code !== 'ENOENT') return { ok: false, error: 'marks-unreadable' };
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'bad-marks-data' };
	if (data.sessions !== undefined && (!data.sessions || typeof data.sessions !== 'object' || Array.isArray(data.sessions))) return { ok: false, error: 'bad-sessions-data' };
	if (!data.sessions) data.sessions = {};
	const cur = Object.hasOwn(data.sessions, id) ? data.sessions[id] : {};
	if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return { ok: false, error: 'bad-session-data' };
	cur.overrides = { ...(cur.overrides || {}) };
	if (payload.clear === true) {
		data.sessions[id] = { favorite: false, reviewLater: false, tags: [], overrides: { favorite: true, reviewLater: true, tags: true } };
	} else {
		if (typeof payload.reviewLater === 'boolean') { cur.reviewLater = payload.reviewLater; cur.overrides.reviewLater = true; }
		if (typeof payload.favorite === 'boolean') { cur.favorite = payload.favorite; cur.overrides.favorite = true; }
		if (Array.isArray(payload.tags)) {
			cur.tags = [...new Set(payload.tags.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean))].slice(0, 12).map(x => x.slice(0, 80));
			cur.overrides.tags = true;
		}
		const empty = cur.reviewLater !== true && cur.favorite !== true
			&& !(Array.isArray(cur.tags) && cur.tags.length > 0);
		if (empty && Object.keys(cur.overrides).length === 0) delete data.sessions[id];
		else {
			cur.updatedAt = new Date().toISOString();
			data.sessions[id] = cur;
		}
	}
	data.version = 2;
	writeJsonAtomic(target, data);
	
	return { ok: true, sessionId: id, session: readMarks(target, file ? target : ANNOTATIONS).sessions[id] || null };
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
				const fd = fs.openSync(full, 'r');
                try { const buf=Buffer.alloc(65536); const n=fs.readSync(fd,buf,0,buf.length,0); return parse(buf.subarray(0,n).toString('utf8')); } finally {fs.closeSync(fd);}
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
            if (chunks.reduce((n,b) => n+b.length,0) > 1024*1024) { finish(null); return; }
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
    Object.defineProperty(out, 'complete', {value:true,writable:true});
	let workspaces = [];
	try {
		workspaces = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
			.filter((d) => d.isDirectory() && d.name !== '.trash');
	} catch {
        out.complete = false;
		return out;
	}
	for (const w of workspaces) {
		const wdir = path.join(SESSIONS_DIR, w.name);
		let dirs = [];
		try {
			dirs = fs.readdirSync(wdir, { withFileTypes: true }).filter((d) => d.isDirectory());
		} catch {
            out.complete = false;
			continue;
		}
		for (const d of dirs) {
			const dir = path.join(wdir, d.name);
			const header = await readSessionHeader(dir);
			if (header && header.id) out.push(Object.assign({}, header, { dir }));
            else out.complete = false;
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
	if (!headers.complete) return { ok:false,status:409,error:'incomplete-session-index' };
    const matches = headers.filter(h => h.id === id);
    if (matches.length > 1) return {ok:false,status:409,error:'ambiguous-session-id'};
    const target = matches[0];
	if (!target) return { ok: false, status: 404, error: 'not-found' };

	const subs = headers.filter((h) => h.origin === 'subagent' && h.parentSession === id);
	if (subs.length > 0) {
		return { ok: false, status: 409, error: 'has-subagents', subagents: subs.map((s) => s.id) };
	}

	if (!ctx?.sessions || typeof ctx.sessions.get !== 'function') return {ok:false,status:409,error:'unknown-session-state'};
    let live = null;
	try {
		live = ctx.sessions.get(id);
	} catch { return {ok:false,status:409,error:'unknown-session-state'}; }
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


function trustedOrigin(req) {
 const origin=req.headers?.origin;
 if (origin==='null') return req.headers?.['x-dsh-marks']==='1';
 if (!origin) return true; // Same-user local processes remain in the trust boundary.
 try { const u=new URL(origin); return u.protocol==='dsh-app:' || (['http:','https:'].includes(u.protocol) && u.host===req.headers.host); } catch { return false; }
}
function send(res,status,data) {
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
 res.end(JSON.stringify(data));
}
async function readBody(req) {
 let raw='';
 for await (const chunk of req) { raw+=chunk; if(Buffer.byteLength(raw)>16384) throw new Error('body-too-large'); }
 const body=JSON.parse(raw||'{}');
 if (!body || typeof body!=='object' || Array.isArray(body)) throw new Error('bad-json');
 return body;
}
function createHandler(ctx) {
 return async (req,res) => {
  try {
   if (req.headers?.['x-dsh-marks']!=='1' || !trustedOrigin(req)) return send(res,403,{ok:false,error:'forbidden-origin'});
   const url=new URL(req.url,'http://localhost');
   if (!url.pathname.startsWith(API+'/')) return send(res,404,{ok:false,error:'not-found'});
   const route=url.pathname.slice(API.length);
   if(req.method==='GET' && route==='/health') return send(res,200,{ok:true,plugin:name,version:VERSION});
   if(req.method==='GET' && route==='/marks') return send(res,200,readMarks());
   if(req.method==='GET' && route==='/catalog') {
    const raw=await ctx.sessionPersistence.list();
    let cached=[];
    try { cached=Array.from(ctx.workspaceRegistry?.headers?.values?.()||[]); } catch {}
    const marks=readMarks().sessions;
    const ids=raw.map(v=>(v?.header||v)?.id).filter(id=>marks[id]&&(marks[id].favorite===true||marks[id].reviewLater===true||(marks[id].marks||[]).some(k=>k==='later'||k==='favorite')));
    if(ids.length && typeof ctx.sessionQuery?.readTitleSnapshots==='function') {
     const titles=await ctx.sessionQuery.readTitleSnapshots(ids);
     for(const result of titles) {
      if(result.status==='fulfilled' && result.value?.session?.id && typeof result.value?.title?.title==='string')
       cached.push({id:result.value.session.id,title:result.value.title.title});
     }
    }
    return send(res,200,{ok:true,items:buildCatalog(raw,cached,marks,url.searchParams.get('filter')||'all',url.searchParams.get('q')||'')});
   }
   if(req.method==='POST' && route==='/mark') {
    const body=await readBody(req);
    // No tag/clear operations in the minimal product. Historical tags remain untouched.
    if (Object.keys(body).some(k=>!['sessionId','favorite','reviewLater'].includes(k)) ||
        !['favorite','reviewLater'].some(k=>typeof body[k]==='boolean') ||
        ['favorite','reviewLater'].some(k=>body[k]!==undefined && typeof body[k]!=='boolean')) return send(res,400,{ok:false,error:'bad-mark'});
    const raw=await ctx.sessionPersistence.list();
    if(!Array.isArray(raw)) return send(res,503,{ok:false,error:'session-index-unavailable'});
    if(!raw.some(value=>(value?.header||value)?.id===body.sessionId)) return send(res,404,{ok:false,error:'not-found'});
    const result=applyMark(body);return send(res,result.ok?200:400,result);
   }
   if(req.method==='POST' && route==='/session-delete') {
    const body=await readBody(req);
    if(body.confirmed!==true) return send(res,400,{ok:false,error:'confirmation-required'});
    const result=await deleteSessionById(ctx,String(body.sessionId||''));
    return send(res,result.status||200,result);
   }
   return send(res,404,{ok:false,error:'not-found'});
  } catch(error) {
   const invalid=['bad-json','body-too-large'].includes(error.message)||error instanceof SyntaxError;
   log('request failed '+(invalid?'invalid-input':error.name));
   return send(res,invalid?400:500,{ok:false,error:invalid?'bad-request':'request-failed'});
  }
 };
}
export function apply(ctx) {
 ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:API,handler:createHandler(ctx)}));
 log('plugin applied '+VERSION);
}
export const __test={readMarks,applyMark,deleteSessionById,scanSessionHeaders,createHandler,trustedOrigin};
