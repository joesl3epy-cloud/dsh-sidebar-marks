import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __test } from '../lib/index.js';

const { readMarks } = __test;

function tmpFile(name, content) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsm-'));
	const file = path.join(dir, name);
	if (content !== undefined) fs.writeFileSync(file, content, 'utf8');
	return file;
}

test('标记文件不存在时静默返回 installed:false', () => {
	const file = tmpFile('missing.json');
	const r = readMarks(file, file);
	assert.equal(r.ok, true);
	assert.equal(r.installed, false);
	assert.deepEqual(r.sessions, {});
});

test('坏 JSON 不抛错，标记为 bad-json', () => {
	const file = tmpFile('bad.json', '{ not json');
	const r = readMarks(file, file);
	assert.equal(r.ok, true);
	assert.equal(r.installed, true);
	assert.equal(r.error, 'bad-json');
	assert.deepEqual(r.sessions, {});
});

test('收藏与待回看可以同时存在（不会被其中一个吞掉）', () => {
	const file = tmpFile('a.json', JSON.stringify({
		version: 1,
		sessions: { s1: { favorite: true, reviewLater: true, tags: [] } },
	}));
	const r = readMarks(file, file);
	assert.deepEqual(r.sessions.s1.marks.sort(), ['favorite', 'later']);
});

test('只有标签时也算一条标记，且保留 tags 原文', () => {
	const file = tmpFile('t.json', JSON.stringify({
		version: 1,
		sessions: { s2: { favorite: false, reviewLater: false, tags: ['Personal_record'] } },
	}));
	const r = readMarks(file, file);
	assert.deepEqual(r.sessions.s2.marks, ['tag']);
	assert.deepEqual(r.sessions.s2.tags, ['Personal_record']);
});

test('全 false 且无标签的会话不进入结果，避免画空点', () => {
	const file = tmpFile('e.json', JSON.stringify({
		version: 1,
		sessions: { s3: { favorite: false, reviewLater: false, tags: [] } },
	}));
	const r = readMarks(file, file);
	assert.equal(r.sessions.s3, undefined);
});

test('priority 只在是数字时透传，否则为 null', () => {
	const file = tmpFile('p.json', JSON.stringify({
		version: 1,
		sessions: {
			a: { reviewLater: true, priority: 3 },
			b: { reviewLater: true, priority: 'high' },
		},
	}));
	const r = readMarks(file, file);
	assert.equal(r.sessions.a.priority, 3);
	assert.equal(r.sessions.b.priority, null);
});

test('写入自己的文件：打开待回看能在合并结果里读到', async () => {
	const own = tmpFile('own.json', JSON.stringify({ version: 1, sessions: {} }));
	const { applyMark } = __test;
	const r = applyMark({ sessionId: 's-write', reviewLater: true }, own);
	assert.equal(r.ok, true);
	assert.deepEqual(r.session.marks, ['later']);
	const merged = readMarks(own, own);
	assert.deepEqual(merged.sessions['s-write'].marks, ['later']);
});

test('两侧都标同一会话时按「或」合并，标签取并集', () => {
	const own = tmpFile('own2.json', JSON.stringify({
		version: 1,
		sessions: { s1: { favorite: true, tags: ['mine'] } },
	}));
	const shared = tmpFile('shared2.json', JSON.stringify({
		version: 1,
		sessions: { s1: { reviewLater: true, tags: ['theirs'] } },
	}));
	const r = readMarks(own, shared);
	assert.deepEqual(r.sessions.s1.marks.sort(), ['favorite', 'later', 'tag']);
	assert.deepEqual(r.sessions.s1.tags.sort(), ['mine', 'theirs']);
});

test('全部关掉后保留本地取消记录，合并结果不再显示', () => {
	const own = tmpFile('own3.json', JSON.stringify({
		version: 1,
		sessions: { s2: { reviewLater: true } },
	}));
	const { applyMark } = __test;
	const r = applyMark({ sessionId: 's2', reviewLater: false, favorite: false, tags: [] }, own);
	assert.equal(r.session, null);
	const after = JSON.parse(fs.readFileSync(own, 'utf8'));
	assert.equal(after.sessions.s2.reviewLater, false);
	assert.equal(after.sessions.s2.overrides.reviewLater, true);
});

test('显式取消能覆盖共享收藏；清除后不会因共享标记复活', () => {
 const own = tmpFile('override.json', JSON.stringify({ sessions: {} }));
 const shared = tmpFile('shared.json', JSON.stringify({ sessions: { demo: { favorite: true, tags: ['共享'] } } }));
 __test.applyMark({ sessionId: 'demo', favorite: false }, own);
 assert.deepEqual(readMarks(own, shared).sessions.demo.marks, ['tag']);
 __test.applyMark({ sessionId: 'demo', clear: true }, own);
 assert.equal(readMarks(own, shared).sessions.demo, undefined);
});
test('坏标记文件禁止覆盖，危险对象键拒绝写入', () => {
 const own = tmpFile('broken.json', '{bad');
 assert.equal(__test.applyMark({ sessionId: 'demo', favorite: true }, own).ok, false);
 assert.equal(fs.readFileSync(own, 'utf8'), '{bad');
 assert.equal(__test.applyMark({ sessionId: '__proto__', favorite: true }, own).ok, false);
});
test('标签去重、去空格并忽略非字符串，兼容脏共享数据', () => {
 const own = tmpFile('tags.json', JSON.stringify({ sessions: {} }));
 __test.applyMark({ sessionId: 'demo', tags: [' a ', 'a', null, {}, ''] }, own);
 assert.deepEqual(readMarks(own, own).sessions.demo.tags, ['a']);
});
test('远程网页与 null Origin 禁止访问，本地 DSH 页面可访问', () => {
 assert.equal(__test.trustedOrigin({headers:{origin:'null'}}), false);
 assert.equal(__test.trustedOrigin({headers:{origin:'https://example.com'}}), false);
 assert.equal(__test.trustedOrigin({headers:{origin:'dsh-app://index.html'}}), true);
 assert.equal(__test.trustedOrigin({headers:{}}), true);
});
