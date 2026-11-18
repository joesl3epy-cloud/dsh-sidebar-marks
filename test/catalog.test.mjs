import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCatalog,visibleKind} from '../lib/catalog.mjs';
test('固定待回看优先，只有标签不显示，不受旧all/priority设置影响',()=>{
 assert.equal(visibleKind({favorite:true,reviewLater:true,displayMode:'all',priority:['favorite','later']}),'later');
 assert.equal(visibleKind({favorite:true}),'favorite');assert.equal(visibleKind({tags:['旧'],marks:['tag']}),null);
});
test('目录来自持久化全量索引，跨工作区、隐藏会话、收藏与待回看交集均可找回',()=>{
 const raw=[{header:{id:'a',cwd:'/A'},state:{title:'合同'}},{id:'b',cwd:'/B',title:'方案'},{id:'c',cwd:'/C',title:'旧标签'}];
 const cache=[{id:'a',title:'最新合同',cwd:'/A'},{id:'deleted',title:'过期缓存'}];
 const marks={a:{favorite:true,reviewLater:true},b:{reviewLater:true},c:{tags:['only']},deleted:{favorite:true}};
 const all=buildCatalog(raw,cache,marks);assert.equal(all.length,2);assert.equal(all.find(x=>x.id==='a').kind,'later');
 assert.equal(buildCatalog(raw,cache,marks,'favorite').length,1);assert.equal(buildCatalog(raw,cache,marks,'later').length,2);
 assert.equal(buildCatalog(raw,cache,marks,'all','最新').length,1);assert.equal(buildCatalog(raw,cache,marks,'all','方案')[0].id,'b');
 assert.throws(()=>buildCatalog({},[],marks));assert.throws(()=>buildCatalog(raw,[],marks,'tag'));
});

test('命名记录覆盖头部编号，未命名时不泄露编号，搜索只匹配名称',()=>{
 const raw=[{id:'session-secret-id',cwd:'/private/work'}];
 const marks={'session-secret-id':{favorite:true}};
 assert.equal(buildCatalog(raw,[],marks)[0].title,'未命名会话');
 const cached=[{id:'session-secret-id',title:'我的工作计划'}];
 assert.equal(buildCatalog(raw,cached,marks)[0].title,'我的工作计划');
 assert.equal(buildCatalog(raw,cached,marks,'all','private').length,0);
});
