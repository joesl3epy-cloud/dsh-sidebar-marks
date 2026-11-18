import test from 'node:test';
import assert from 'node:assert/strict';
import {boot,flush} from './dom.mjs';
async function menuButtons(app){return Array.from(await app.menuResolve()).map(item=>({textContent:item.label.replace(' · 会话标记','').replace(/^取消/,''),emit(){if(!item.disabled)item.run()}}))}

test('factory无副作用；操作注册到官方菜单，未展开不查列表',async()=>{
 const app=boot();assert.equal(app.calls.length,0);assert.equal(typeof app.plugin.apply,'function');app.start();await flush();
 assert.equal(app.aside.firstChild,app.header);assert.equal(app.aside.querySelector('.dsm-search').hidden,true);assert.equal(app.aside.querySelector('section').hidden,true);
 assert.equal(app.calls.some(c=>c.url.endsWith('/catalog')),false);
 assert.deepEqual((await menuButtons(app)).map(b=>b.textContent),['待回看','收藏','删除会话']);app.stop();
});
test('只显示待回看，取消后显示收藏；再次点击关闭，不碰历史标签',async()=>{
 const app=boot({initial:{one:{reviewLater:true,favorite:true,tags:['保留']},two:{tags:['不显示']}}});app.start();await flush();
 assert.equal(app.rows.one.querySelectorAll('[data-dsm-marker]').length,1);
 assert.equal(app.rows.one.querySelector('[data-dsm-marker]').getAttribute('data-kind'),'later');
 assert.equal(app.rows.two.querySelectorAll('[data-dsm-marker]').length,0);
 (await menuButtons(app))[0].emit('click');await flush();
 assert.equal(app.rows.one.querySelector('[data-dsm-marker]').getAttribute('data-kind'),'favorite');
 const written=JSON.parse(app.calls.find(c=>c.url.endsWith('/mark')).opt.body);
 assert.equal(written.reviewLater,false);assert.equal(written.tags,undefined);
 (await menuButtons(app))[1].emit('click');await flush();
 assert.equal(app.rows.one.querySelectorAll('[data-dsm-marker]').length,0);app.stop();
});
test('原生放大镜展开独立插件区域；分别搜索收藏和待回看，不改变官方输入和结果',async()=>{
 const app=boot({initial:{one:{favorite:true},two:{reviewLater:true}},items:[{id:'one',title:'合同',workspace:'/work/A'},{id:'two',title:'方案',workspace:'/work/B'}]});app.start();await flush();
 assert.equal(app.calls.some(c=>c.url.endsWith('/catalog')),false);
 app.nativeInput.value='官方搜索';app.search();await flush();
 const region=app.aside.querySelector('.dsm-search');assert.equal(region.hidden,false);assert.match(region.textContent,/会话标记/);
 assert.equal(app.aside.querySelector('[data-filter="all"]'),null);
 assert.equal(app.aside.querySelectorAll('.dsm-result').length,1);
 app.aside.querySelector('[data-filter="later"]').emit('click');
 assert.equal(region.querySelector('input'),null);
 assert.equal(app.aside.querySelectorAll('.dsm-result').length,1);assert.equal(app.nativeInput.value,'官方搜索');assert.equal(region.querySelector('.dsm-workspace'),null);assert.equal(region.querySelector('.dsm-result').title,'方案');
 app.aside.querySelector('.dsm-result').emit('click');await flush();assert.deepEqual(app.opens,['two']);
 app.search(false);await flush();assert.equal(region.hidden,true);app.stop();
});
test('删除取消不发送请求，确认才发送；不手动移除React会话行',async()=>{
 for(const confirm of [false,true]){const app=boot({confirm});app.start();await flush();(await menuButtons(app))[2].emit('click');await flush();
 const calls=app.calls.filter(c=>c.url.endsWith('/session-delete'));assert.equal(calls.length,confirm?1:0);
 if(confirm)assert.equal(JSON.parse(calls[0].opt.body).confirmed,true);
 assert.equal(app.rows.one.parentNode,app.aside);app.stop();}
});
test('失败不改变标记，重复点击不重复提交；停用清理并阻断迟到响应',async()=>{
 const app=boot({initial:{one:{favorite:true}},failMark:true});app.start();await flush();const b=(await menuButtons(app))[1];b.emit('click');b.emit('click');await flush();
 assert.equal(app.calls.filter(c=>c.url.endsWith('/mark')).length,1);assert.equal(app.rows.one.querySelector('[data-dsm-marker]').getAttribute('data-kind'),'favorite');assert.equal(app.notices.length,1);app.stop();assert.equal(app.timers.size,0);assert.equal(app.aside.querySelector('.dsm-search'),null);assert.equal(app.card.querySelector('[data-dsm-hover]'),null);assert.ok(app.observers.every(o=>!o.active));
 const late=boot({deferred:true});late.start();late.stop();late.resolve();await flush();assert.equal(late.aside.querySelector('.dsm-search'),null);assert.ok(late.controllers.every(c=>c.aborted));
});


test('React会话行复用时清理旧标记，侧栏整体替换可重新挂载',async()=>{
 const app=boot({initial:{one:{favorite:true}}});app.start();await flush();
 assert.equal(app.rows.one.querySelectorAll('[data-dsm-marker]').length,1);
 app.rows.one['__reactFiber$test'].memoizedProps.node.id='unmarked';app.trigger();app.runTimers();await flush();
 assert.equal(app.rows.one.querySelectorAll('[data-dsm-marker]').length,0);
 const root=app.aside.parentNode;root.removeChild(app.aside);const fresh=app.doc.createElement('aside');root.appendChild(fresh);
 app.trigger();app.runTimers();await flush();assert.equal(fresh.querySelectorAll('.dsm-search').length,0);app.stop();
});


test('清理旧空心标签与分组圆点、占位和样式，保留原生控件与唯一核心标记',async()=>{
 const app=boot({initial:{one:{favorite:true},two:{tags:['保留数据']}}});
 const old=app.doc.createElement('style');old.setAttribute('data-dsm-marks','1');app.doc.head.appendChild(old);
 for(const cls of ['dsm-dot dsm-dot-tag','dsm-dot dsm-dot-group','dsm-spacer']){const dot=app.doc.createElement('span');dot.className=cls;app.rows.two.appendChild(dot)}
 const native=app.rows.two.querySelector('[class*="pinIndicator"]');
 app.start();await flush();
 assert.equal(old.parentNode,null);assert.equal(app.aside.querySelectorAll('.dsm-dot,.dsm-spacer').length,0);
 assert.equal(app.rows.two.querySelectorAll('[data-dsm-marker]').length,0);
 assert.equal(app.rows.one.querySelectorAll('[data-dsm-marker]').length,1);
 assert.equal(native.parentNode,app.rows.two);
 assert.deepEqual((await menuButtons(app)).map(b=>b.textContent),['待回看','收藏','删除会话']);app.stop();
});

test('右键确认后只取消当前页签标记；取消确认不写入；失败保留原状态',async()=>{
 for(const confirm of [false,true]){
  const app=boot({confirm,initial:{one:{favorite:true,reviewLater:true}},items:[{id:'one',title:'工作计划'}]});
  app.start();await flush();app.search();await flush();
  assert.equal(app.aside.querySelector('.dsm-search').querySelector('input'),null);
  app.aside.querySelector('.dsm-result').emit('contextmenu');await flush();
  const calls=app.calls.filter(c=>c.url.endsWith('/mark'));assert.equal(calls.length,confirm?1:0);
  if(confirm){assert.deepEqual(JSON.parse(calls[0].opt.body),{sessionId:'one',favorite:false});
   assert.equal(app.aside.querySelectorAll('.dsm-result').length,0);
   app.aside.querySelector('[data-filter="later"]').emit('click');assert.equal(app.aside.querySelectorAll('.dsm-result').length,1);
   app.aside.querySelector('.dsm-result').emit('contextmenu');await flush();
   assert.deepEqual(JSON.parse(app.calls.filter(c=>c.url.endsWith('/mark'))[1].opt.body),{sessionId:'one',reviewLater:false});}
  assert.equal(app.opens.length,0);app.stop();
 }
 const app=boot({failMark:true,initial:{one:{favorite:true}},items:[{id:'one',title:'保留'}]});app.start();await flush();app.search();await flush();
 app.aside.querySelector('.dsm-result').emit('contextmenu');await flush();assert.equal(app.aside.querySelectorAll('.dsm-result').length,1);assert.equal(app.notices.length,1);app.stop();
});

test('官方菜单使用捕获会话ID，不从悬停猜测；状态文案与卸载清理',async()=>{
 const app=boot({initial:{two:{favorite:true}}});app.start();await flush();
 const menu=await app.menuResolve('two','第二个会话');assert.equal(menu[0].separatorBefore,true);
 assert.equal(menu[1].label,'取消收藏 · 会话标记');assert.equal(menu[2].danger,true);
 assert.equal(app.card.querySelector('[data-dsm-hover]'),null);
 await menu[1].run();
 const body=JSON.parse(app.calls.find(c=>c.url.endsWith('/mark')).opt.body);
 assert.deepEqual(body,{sessionId:'two',favorite:false});
 app.stop();assert.deepEqual(await app.menuResolve(),[]);
});
