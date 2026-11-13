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
	const r = readMarks(file);
	assert.equal(r.ok, true);
	assert.equal(r.installed, false);
	assert.deepEqual(r.sessions, {});
});

test('坏 JSON 不抛错，标记为 bad-json', () => {
	const file = tmpFile('bad.json', '{ not json');
	const r = readMarks(file);
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
	const r = readMarks(file);
	assert.deepEqual(r.sessions.s1.marks.sort(), ['favorite', 'later']);
});

test('只有标签时也算一条标记，且保留 tags 原文', () => {
	const file = tmpFile('t.json', JSON.stringify({
		version: 1,
		sessions: { s2: { favorite: false, reviewLater: false, tags: ['Personal_record'] } },
	}));
	const r = readMarks(file);
	assert.deepEqual(r.sessions.s2.marks, ['tag']);
	assert.deepEqual(r.sessions.s2.tags, ['Personal_record']);
});

test('全 false 且无标签的会话不进入结果，避免画空点', () => {
	const file = tmpFile('e.json', JSON.stringify({
		version: 1,
		sessions: { s3: { favorite: false, reviewLater: false, tags: [] } },
	}));
	const r = readMarks(file);
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
	const r = readMarks(file);
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
