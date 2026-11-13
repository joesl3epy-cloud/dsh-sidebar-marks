import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

function makeSandbox() {
	const doc = {
		readyState: 'complete',
		head: { appendChild() {} },
		documentElement: { appendChild() {} },
		querySelector: () => null,
		querySelectorAll: () => [],
		createElement: () => ({ setAttribute() {}, style: {}, appendChild() {}, textContent: '' }),
		addEventListener() {},
		removeEventListener() {},
	};
	const sandbox = {
		document: doc,
		location: { href: 'dsh-app://index.html' },
		fetch: () => Promise.resolve({ json: () => Promise.resolve({ sessions: {} }) }),
		setInterval: () => 0,
		clearInterval() {},
		setTimeout: () => 0,
		clearTimeout() {},
		MutationObserver: class {
			observe() {}
			disconnect() {}
		},
		EventSource: class {
			constructor() {}
			addEventListener() {}
			close() {}
		},
		console,
	};
	sandbox.window = { __ModuleLoader__: { load(opts) { sandbox.__captured = opts; } } };
	sandbox.window.document = doc;
	return sandbox;
}

function loadModule() {
	const sandbox = makeSandbox();
	vm.runInNewContext(src, sandbox);
	return sandbox.__captured;
}

test('通过 __ModuleLoader__ 注册，且 id 与包名完全一致', () => {
	const captured = loadModule();
	assert.ok(captured, 'factory 没有被注册');
	assert.equal(captured.id, 'dsh-sidebar-marks');
	assert.equal(typeof captured.factory, 'function');
});

test('factory 返回的对象带 apply / inject，apply 不抛错', () => {
	const captured = loadModule();
	const mod = captured.factory();
	assert.equal(typeof mod, 'object');
	assert.equal(typeof mod.apply, 'function');
	assert.ok(Array.isArray(mod.inject));
	assert.doesNotThrow(() => mod.apply({ effect() {} }));
});

test('没有遗留的调试上报接口（/probe、picker）', () => {
	assert.equal(src.includes('/probe'), false);
	assert.equal(src.includes('picker'), false);
	assert.equal(src.includes('factory-loaded'), false);
});

test('写操作只通过自己的 /mark 接口，不直接碰别的插件的数据文件', () => {
	const writes = Array.from(new Set((src.match(/["'`]\/(mark|style|probe|config)["'`]/g) || [])
		.map((w) => w.replace(/["'`]/g, ''))));
	assert.deepEqual(writes.sort(), ['/mark', '/style']);
	assert.equal(src.includes('annotations.v1.json'), false);
});

test('只请求本地回环地址', () => {
	const urls = src.match(/https?:\/\/[^"'\s]+/g) || [];
	assert.ok(urls.length > 0, '没有找到任何请求地址');
	for (const u of urls) {
		assert.match(u, /^http:\/\/127\.0\.0\.1(?:[:/]|$)/, `出现了非回环地址：${u}`);
	}
});
