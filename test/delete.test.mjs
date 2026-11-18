import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsm-del-'));
process.env.DSH_HOME = home;
const { __test } = await import('../lib/index.js');
const { deleteSessionById, scanSessionHeaders } = __test;

const idle={sessions:{get:()=>null}};
const SESSIONS = path.join(home, 'sessions');
const WS = path.join(SESSIONS, '--tmp--');

function makeSession(id, header = {}) {
	const dir = path.join(WS, id);
	fs.mkdirSync(dir, { recursive: true });
	const line = JSON.stringify(Object.assign({ type: 'session', version: 4, id, cwd: '/tmp', createdAt: 1 }, header)) + '\n';
	fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(line)));
	return dir;
}

test('扫描能读到每个会话的头部', async () => {
	makeSession('session-aaaa-0001');
	const headers = await scanSessionHeaders();
	assert.equal(headers.some((h) => h.id === 'session-aaaa-0001'), true);
});

test('删除是移进 .trash，不是直接抹掉', async () => {
	const dir = makeSession('session-aaaa-0002');
	const r = await deleteSessionById(idle, 'session-aaaa-0002');
	assert.equal(r.ok, true);
	assert.equal(fs.existsSync(dir), false);
	assert.equal(fs.existsSync(r.movedTo), true);
});

test('有子 agent 时拒绝删除', async () => {
	makeSession('session-aaaa-0003');
	makeSession('session-sub-0003', { origin: 'subagent', parentSession: 'session-aaaa-0003' });
	const r = await deleteSessionById(idle, 'session-aaaa-0003');
	assert.equal(r.ok, false);
	assert.equal(r.error, 'has-subagents');
	assert.equal(fs.existsSync(path.join(WS, 'session-aaaa-0003')), true);
});

test('正在运行的会话拒绝删除', async () => {
	makeSession('session-aaaa-0004');
	const ctx = { sessions: { get: (id) => (id === 'session-aaaa-0004' ? { id } : undefined) } };
	const r = await deleteSessionById(ctx, 'session-aaaa-0004');
	assert.equal(r.error, 'session-in-use');
});

test('不存在的会话返回 404，非法 id 返回 400', async () => {
	const miss = await deleteSessionById(idle, 'session-nope-9999');
	assert.equal(miss.status, 404);
	const bad = await deleteSessionById(idle, '../etc');
	assert.equal(bad.status, 400);
});


test('未知状态、有坏会话头或重复ID时拒绝删除',async()=>{
 const id='session-safe-5555';const dir=makeSession(id);
 assert.equal((await deleteSessionById(null,id)).error,'unknown-session-state');
 const broken=path.join(WS,'broken');fs.mkdirSync(broken);fs.writeFileSync(path.join(broken,'session.v4.jsonl'),'invalid');
 assert.equal((await deleteSessionById(idle,id)).error,'incomplete-session-index');assert.equal(fs.existsSync(dir),true);
 fs.unlinkSync(path.join(broken,'session.v4.jsonl'));fs.rmdirSync(broken);
 const duplicate=path.join(SESSIONS,'other',id);fs.mkdirSync(duplicate,{recursive:true});
 fs.copyFileSync(path.join(dir,'session.v4.jsonl.zstd'),path.join(duplicate,'session.v4.jsonl.zstd'));
 assert.equal((await deleteSessionById(idle,id)).error,'ambiguous-session-id');assert.equal(fs.existsSync(dir),true);
});
