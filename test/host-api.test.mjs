import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsm-api-'));process.env.DSH_HOME=home;
const {__test,apply,inject}=await import('../lib/index.js');
async function server(t){
 const ctx={sessions:{get:()=>null},sessionPersistence:{list:async()=>[{id:'alpha',title:'A',cwd:'/A'},{id:'bravo',title:'B',cwd:'/B'}]},workspaceRegistry:{headers:new Map()},sessionQuery:{readTitleSnapshots:async ids=>ids.map(id=>({status:'fulfilled',value:{session:{id},title:{title:'Renamed '+id}}}))}};
 const handler=__test.createHandler(ctx);const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>{s.close(r);s.closeAllConnections()}));
 return async(route,body,headers={'x-dsh-marks':'1'})=>{
 const response=await fetch('http://127.0.0.1:'+s.address().port+'/sidebar-marks/api'+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
 return {status:response.status,body:await response.json(),cors:response.headers.get('access-control-allow-origin')};
 }
}
test('不依赖Session Manager即可开关收藏、待回看及跨工作区查询',async t=>{
 const call=await server(t);
 assert.equal((await call('/mark',{sessionId:'alpha',favorite:true})).status,200);
 await call('/mark',{sessionId:'alpha',reviewLater:true});await call('/mark',{sessionId:'bravo',reviewLater:true});
 assert.equal((await call('/catalog')).body.items.length,2);
 assert.equal((await call('/catalog?filter=favorite')).body.items[0].title,'Renamed alpha');
 assert.equal((await call('/catalog?filter=favorite')).body.items[0].id,'alpha');
 await call('/mark',{sessionId:'alpha',reviewLater:false});
 assert.equal((await call('/catalog?filter=favorite')).body.items[0].kind,'favorite');
 assert.equal((await call('/mark',{sessionId:'alpha',tags:['not-allowed']})).status,400);
 assert.equal((await call('/mark',{sessionId:'alpha',clear:true})).status,400);
 assert.equal((await call('/mark',{sessionId:'ghost',favorite:true})).status,404);
});
test('缺少请求头、远程来源不准写入；null来源仅在自定义头存在时可用，无跨域放行',async t=>{
 const call=await server(t);
 assert.equal((await call('/marks',undefined,{})).status,403);
 assert.equal((await call('/mark',{sessionId:'alpha',favorite:true},{'x-dsh-marks':'1',origin:'https://evil.example'})).status,403);
 const ok=await call('/marks',undefined,{'x-dsh-marks':'1',origin:'null'});assert.equal(ok.status,200);assert.equal(ok.cors,null);
 assert.equal((await call('/session-delete',{sessionId:'alpha'})).body.error,'confirmation-required');
});
test('宿主只注册自己的路由并由Cordis清理，不新增回环端口',()=>{
 let cleanup,removed=false,handler;
 const ctx={webServer:{register(options){handler=options.handler;return ()=>{removed=true}}},effect(fn){cleanup=fn()}};
 apply(ctx);assert.equal(typeof handler,'function');assert.ok(!inject.includes('dsh-session-manager'));cleanup();assert.equal(removed,true);
});
