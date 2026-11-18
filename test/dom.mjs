import fs from 'node:fs';
import vm from 'node:vm';
export class El {
 constructor(tag){this.tagName=tag;this.className='';this.attrs={};this.children=[];this.parentNode=null;this.listeners={};this.style={};this._text='';this.hidden=false}
 get parentElement(){return this.parentNode}
 get nodeType(){return 1}
 contains(n){while(n){if(n===this)return true;n=n.parentNode}return false}
 get firstChild(){return this.children[0]||null}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}
 set textContent(t){this._text=String(t);this.children=[]}
 appendChild(c){if(c.parentNode)c.remove();this.children.push(c);c.parentNode=this;return c}
 insertBefore(c,b){if(c.parentNode)c.remove();const i=b?this.children.indexOf(b):this.children.length;this.children.splice(i,0,c);c.parentNode=this;return c}
 removeChild(c){const i=this.children.indexOf(c);if(i>=0)this.children.splice(i,1);c.parentNode=null}
 remove(){this.parentNode?.removeChild(this)}
 setAttribute(k,v){this.attrs[k]=String(v)}
 getAttribute(k){return this.attrs[k]??null}
 addEventListener(k,fn){(this.listeners[k]??=[]).push(fn)}
 removeEventListener(k,fn){this.listeners[k]=(this.listeners[k]||[]).filter(x=>x!==fn)}
 focus(){this.focused=true}
 emit(k,extra={}){if(this.disabled)return;for(const f of this.listeners[k]||[])f({preventDefault(){},stopPropagation(){},...extra})}
 matches(sel){
  if(/^[a-z]+$/.test(sel))return this.tagName===sel;if(sel==='aside')return this.tagName==='aside';if(sel==='input')return this.tagName==='input';
  const compound=/^([a-z]+)(\[.*\])$/.exec(sel);if(compound)return this.tagName===compound[1]&&this.matches(compound[2]);
  if(sel.startsWith('.'))return this.className.split(' ').includes(sel.slice(1));
  const m=/^\[([^=*\]]+)(\*?="([^"]*)")?\]$/.exec(sel);if(!m)return false;
  const value=m[1]==='class'?this.className:this.attrs[m[1]];
  return m[2]?m[2].startsWith('*')?String(value||'').includes(m[3]):value===m[3]:value!==undefined;
 }
 querySelectorAll(sel){const out=[];const walk=e=>{for(const c of e.children){if(sel.split(',').some(s=>c.matches(s.trim())))out.push(c);walk(c)}};walk(this);return out}
 querySelector(sel){return this.querySelectorAll(sel)[0]||null}
}
export const flush=()=>new Promise(r=>setImmediate(r));
export function boot({initial={},items=[],failMark=false,confirm=true,openFails=false,deferred=false}={}){
 const doc=new El('document'),head=doc.appendChild(new El('head')),root=doc.appendChild(new El('html')),aside=root.appendChild(new El('aside'));
 doc.head=head;doc.documentElement=root;doc.createElement=tag=>new El(tag);
 const header=aside.appendChild(new El('div'));header.setAttribute('data-sidebar-workspace-header','');
 const nativeSearch=header.appendChild(new El('button'));nativeSearch.setAttribute('aria-expanded','false');
 const nativeInput=header.appendChild(new El('input'));nativeInput.value='';
 const rows={};
 for(const id of ['one','two']){const row=aside.appendChild(new El('div'));row.className='x_sessionRow';row['__reactFiber$test']={memoizedProps:{node:{id}},return:null,stateNode:row};const title=row.appendChild(new El('span'));title.className='x_title';title.textContent=id;const pin=row.appendChild(new El('span'));pin.className='x_pinIndicator';rows[id]=row}
 const card=root.appendChild(new El('div'));card.className='x_hoverContent';card['__reactFiber$test']={memoizedProps:{sessionId:'one'},return:null};
 let captured,dispose,menu;const calls=[],notices=[],opens=[],timers=new Map(),controllers=[],observers=[];let serial=0;
 let marks=structuredClone(initial),pendingResolve;
 const sandbox={document:doc,window:{alert:t=>notices.push(t),confirm:()=>confirm,__ModuleLoader__:{load(d){captured=d}}},AbortController,
 setTimeout(fn){const id=++serial;timers.set(id,fn);return id},clearTimeout(id){timers.delete(id)},setInterval(fn){const id=++serial;timers.set(id,fn);return id},clearInterval(id){timers.delete(id)},
 MutationObserver:class{constructor(fn){this.fn=fn;this.active=true;observers.push(this)}observe(){}disconnect(){this.active=false}},
 fetch:async(url,opt={})=>{
  calls.push({url,opt});controllers.push(opt.signal);
  if(deferred&&url.endsWith('/marks'))return new Promise(resolve=>{pendingResolve=()=>resolve({ok:true,json:async()=>({ok:true,sessions:marks})})});
  let data={ok:true};
  if(url.endsWith('/marks'))data.sessions=marks;
  if(url.endsWith('/catalog'))data.items=items;
  if(url.endsWith('/mark')){
   if(failMark)return {ok:false,json:async()=>({ok:false,error:'write-failed'})};
   const b=JSON.parse(opt.body),m=marks[b.sessionId]||{};
   if(b.favorite!==undefined)m.favorite=b.favorite;if(b.reviewLater!==undefined)m.reviewLater=b.reviewLater;
   m.marks=[];if(m.reviewLater)m.marks.push('later');if(m.favorite)m.marks.push('favorite');
   marks[b.sessionId]=m;data.session=m;
  }
  return {ok:true,json:async()=>data};
 }};
 vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),sandbox);
 const plugin=captured.factory();
 const ctx={contextMenus:{register(entry){menu=entry;return ()=>{menu=null}}},effect(fn){dispose=fn()},sessions:{async refresh(){}},uiWorkspace:{async openSession(id){if(openFails)throw Error('fail');opens.push(id)}}};
 return {doc,aside,header,nativeSearch,nativeInput,card,rows,calls,notices,opens,timers,observers,controllers,plugin,async menuResolve(id='one',title='会话'){return menu?await menu.resolve({sessionId:id,displayTitle:title},new AbortController().signal):[]},start(){plugin.apply(ctx)},search(value=true){nativeSearch.setAttribute('aria-expanded',String(value));for(const o of observers)if(o.active)o.fn([{target:nativeSearch,addedNodes:[]}]);const jobs=[...timers.values()];timers.clear();jobs.forEach(f=>f())},stop(){dispose()},resolve(){pendingResolve?.()},trigger(){for(const o of observers)if(o.active)o.fn([{target:aside,addedNodes:[]}])},runTimers(){const fs=[...timers.values()];timers.clear();fs.forEach(f=>f())}};
}
