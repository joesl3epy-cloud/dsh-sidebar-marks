import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __test } from '../lib/index.js';

const { readMarks, readStyle } = __test;

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

test('readStyle 合并用户配置，缺省回落到默认值', () => {
	const file = tmpFile('style.json', JSON.stringify({ displayMode: 'single', colorLater: '#cf8a7c' }));
	const st = readStyle(file);
	assert.equal(st.displayMode, 'single');
	assert.equal(st.colorLater, '#cf8a7c');
	// 没写的键必须还在
	assert.equal(typeof st.dotSize, 'number');
	assert.equal(st.priority.length, 3);
	assert.equal(st.tagPalette.length, 8);
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

test('全部关掉后该会话从自己的文件里消失', () => {
	const own = tmpFile('own3.json', JSON.stringify({
		version: 1,
		sessions: { s2: { reviewLater: true } },
	}));
	const { applyMark } = __test;
	const r = applyMark({ sessionId: 's2', reviewLater: false, favorite: false, tags: [] }, own);
	assert.equal(r.session, null);
	const after = JSON.parse(fs.readFileSync(own, 'utf8'));
	assert.equal(after.sessions.s2, undefined);
});

test('改颜色只接受合法 #rrggbb，坏值被忽略而不是整份拒掉', () => {
	const file = tmpFile('style2.json', JSON.stringify({ colorLater: '#ec7a70' }));
	const { applyStylePatch } = __test;
	const r = applyStylePatch({ colorLater: '#cf8a7c', colorFavorite: 'red' }, file);
	assert.equal(r.style.colorLater, '#cf8a7c');
	assert.equal(r.style.colorFavorite, '#d9a94e');
});

test('priority 必须是三个互不相同的合法值，否则保持原样', () => {
	const file = tmpFile('style3.json', JSON.stringify({}));
	const { applyStylePatch } = __test;
	const bad = applyStylePatch({ priority: ['later', 'later', 'tag'] }, file);
	assert.deepEqual(bad.style.priority, ['later', 'favorite', 'tag']);
	const good = applyStylePatch({ priority: ['tag', 'later', 'favorite'] }, file);
	assert.deepEqual(good.style.priority, ['tag', 'later', 'favorite']);
});

test('displayMode 只收 all / single', () => {
	const file = tmpFile('style4.json', JSON.stringify({}));
	const { applyStylePatch } = __test;
	assert.equal(applyStylePatch({ displayMode: 'both' }, file).style.displayMode, 'all');
	assert.equal(applyStylePatch({ displayMode: 'single' }, file).style.displayMode, 'single');
});
