window.__ModuleLoader__.load({
 id:'dsh-sidebar-marks',
 factory:function () {
  var API='/sidebar-marks/api';
  function visibleKind(mark) {
   var kinds=mark&&mark.marks||[];
   return mark&&(mark.reviewLater===true||kinds.indexOf('later')>=0)?'later':mark&&(mark.favorite===true||kinds.indexOf('favorite')>=0)?'favorite':null;
  }
  function sessionIdOf(el) {
			var key = null;
			for (var k in el) {
				if (k.indexOf("__reactFiber$") === 0) { key = k; break; }
			}
			if (!key) return null;
			var f = el[key];
			var rowAt = -1;
			for (var i = 0; i < 12 && f; i += 1) {
				try {
					var pr = f.memoizedProps;
					if (pr) {
						// 只认带完整会话 node 的 props，避免蹭到父容器的 sessionId
						if (pr.node && typeof pr.node === "object" && typeof pr.node.id === "string" && pr.node.id) {
							return String(pr.node.id);
						}
						if (i < 6 && typeof pr.sessionId === "string" && pr.sessionId) return String(pr.sessionId);
					}
					// 记下会话行宿主节点的位置；再往上走 3 层就停（要把 SessionRow 组件的 props 读到）
					var sn = f.stateNode;
					if (rowAt < 0 && sn && typeof sn.className === "string" && sn.className.indexOf("sessionRow") >= 0) rowAt = i;
					if (rowAt >= 0 && i >= rowAt + 3) break;
				} catch (e) {}
				f = f.return;
			}
			return null;
		}

  function apply(ctx) {
   var disposed=false,marks={},busy=new Set(),controllers=new Set();
   var sidebar=null,bar=null,panel=null,status=null,list=null,toggle=null,style=null,observer=null;
   var nativeExpanded=false;
   var opened=false,filter='favorite',catalog=[],loading=false,error='',generation=0,timer=null,interval=null;
   function element(tag,text,className) {
    var el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;
   }
   function button(text,click,className) {
    var b=element('button',text,className||'dsm-button');b.type='button';b.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();click()});return b;
   }
   async function request(route,body) {
    if(disposed)throw new Error('disposed');
    var ctrl=new AbortController();controllers.add(ctrl);
    var timeout=setTimeout(function(){ctrl.abort()},8000);
    try {
     var res=await fetch(API+route,{method:body?'POST':'GET',cache:'no-store',signal:ctrl.signal,headers:body?{'content-type':'application/json','x-dsh-marks':'1'}:{'x-dsh-marks':'1'},body:body?JSON.stringify(body):undefined});
     var data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||'请求失败');return data;
    } finally {clearTimeout(timeout);controllers.delete(ctrl)}
   }
   function notice(text){if(!disposed)window.alert(text)}
   function markFor(id){return marks[id]||{}}
   function has(id,key){var m=markFor(id);return m[key]===true||(m.marks||[]).indexOf(key==='reviewLater'?'later':'favorite')>=0}
   async function setMark(id,key,value) {
    if(disposed||busy.has(id))return;
    var payload={sessionId:id};payload[key]=typeof value==='boolean'?value:!has(id,key);busy.add(id);decorate();if(opened)paintList();
    try {
     var data=await request('/mark',payload);if(disposed)return;
     if(data.session)marks[id]=data.session;else delete marks[id];
     if(opened)await loadCatalog();
    } catch(e){notice('保存失败，原标记未改变。请重试。')}
    finally {busy.delete(id);if(!disposed){decorate();if(opened)paintList()}}
   }
   async function removeSession(id,title) {
    if(disposed||busy.has(id))return;
    if(!window.confirm('删除会话「'+(title||id)+'」？\n\n会话将移入可恢复位置；不会永久抹除。'))return;
    busy.add(id);decorate();
    try {
     await request('/session-delete',{sessionId:id,confirmed:true});
     if(disposed)return;
     delete marks[id];
     try {if(typeof ctx.sessions.refresh==='function')await ctx.sessions.refresh();else throw new Error('no refresh')}
     catch(e){notice('会话已移入恢复区，但列表未刷新。请重新打开 DSH，不要重复删除。')}
     if(opened)await loadCatalog();
    } catch(e){
     var messages={'has-subagents':'会话存在子任务，先处理子任务。','session-in-use':'会话仍在运行或已加载，请先关闭它。','unknown-session-state':'无法确认会话状态，暂不删除。','incomplete-session-index':'会话索引不完整，暂不删除。','ambiguous-session-id':'会话编号不唯一，暂不删除。','not-found':'会话不存在，刷新列表后重试。'};
     notice(messages[e.message]||'删除失败，未确认成功。请刷新后重试。');
    } finally {busy.delete(id);if(!disposed)decorate()}
   }
   function clear(el){while(el.firstChild)el.removeChild(el.firstChild)}
   function paintList() {
    if(!panel||!opened||disposed)return;
    status.textContent=loading?'正在查找…':error||'跨工作区显示已标记的会话';clear(list);
    var rows=catalog.filter(function(item){return (filter==='all'||filter==='later'&&has(item.id,'reviewLater')||filter==='favorite'&&has(item.id,'favorite'))});
    if(!loading&&!error&&!rows.length)list.appendChild(element('p','没有匹配的会话','dsm-empty'));
    if(error)list.appendChild(button('重试',loadCatalog));
    rows.forEach(function(item){
     var row=button('',async function(){
      if(!ctx.uiWorkspace||typeof ctx.uiWorkspace.openSession!=='function'){notice('当前 DSH 不支持打开会话');return}
      try {await ctx.uiWorkspace.openSession(item.id);if(!disposed)setOpen(false)}catch(e){notice('打开会话失败，请重试。')}
     },'dsm-result');
     row.title=item.title;
     row.disabled=busy.has(item.id);
     var cancelKey=filter==='later'?'reviewLater':'favorite';
     row.addEventListener('contextmenu',function(e){
      e.preventDefault();e.stopPropagation();
      if(disposed||busy.has(item.id)||!has(item.id,cancelKey))return;
      var label=cancelKey==='reviewLater'?'待回看':'收藏';
      if(window.confirm('取消「'+item.title+'」的'+label+'标记？\n会话内容和另一种标记都会保留。'))setMark(item.id,cancelKey,false);
     });
     var kind=visibleKind(markFor(item.id));
     var dot=element('span','', 'dsm-indicator');dot.setAttribute('data-kind',kind||'');row.appendChild(dot);
     var label=element('span',item.title,'dsm-result-title');row.appendChild(label);
     list.appendChild(row);
    });
   }
   async function loadCatalog() {
    var turn=++generation;loading=true;error='';paintList();
    try {var data=await request('/catalog');if(disposed||turn!==generation)return;catalog=data.items||[]}
    catch(e){if(disposed||turn!==generation)return;error='查找暂不可用，请重试。'}
    finally {if(!disposed&&turn===generation){loading=false;paintList()}}
   }
   function setOpen(value){
    opened=value;if(!panel)return;panel.hidden=!value;
    if(value){loadCatalog()}else{generation++;loading=false}
   }
   function mount() {
    var root=document.querySelector('aside')||document.querySelector('[class*="sidebarCol"]')||document.querySelector('[data-testid="sidebar"]')||document.querySelector('[data-dsh-sidebar]');
    if(!root)return;
    sidebar=root;
    var header=root.querySelector('[data-sidebar-workspace-header]');
    var nativeSearch=header&&header.querySelector('button[aria-expanded]');
    if(!header||!nativeSearch){if(bar)bar.hidden=true;return}
    var expanded=nativeSearch.getAttribute('aria-expanded')==='true';
    if(bar&&bar.parentNode===header.parentNode){
     bar.hidden=!expanded;
     if(nativeExpanded!==expanded){nativeExpanded=expanded;opened=expanded;panel.hidden=!expanded;generation++;if(expanded)loadCatalog()}
     return;
    }
    if(bar&&bar.parentNode)bar.parentNode.removeChild(bar);
    sidebar=root;bar=element('div',undefined,'dsm-search');bar.setAttribute('data-dsm-search','1');
    toggle=element('div','会话标记','dsm-search-label');bar.appendChild(toggle);
    bar.addEventListener('click',function(e){e.stopPropagation()});
    panel=element('section',undefined,'dsm-panel');panel.hidden=!opened;panel.setAttribute('aria-label','查找已标记会话');
    var tabs=element('div',undefined,'dsm-tabs');
    [['favorite','收藏'],['later','待回看']].forEach(function(pair){
     var tab=button(pair[1],function(){filter=pair[0];updateTabs();paintList()});tab.setAttribute('data-filter',pair[0]);tabs.appendChild(tab);
    });panel.appendChild(tabs);
    function updateTabs(){var tabs=panel.querySelectorAll('[data-filter]');for(var i=0;i<tabs.length;i++)tabs[i].setAttribute('aria-pressed',String(tabs[i].getAttribute('data-filter')===filter))}
    updateTabs();
    status=element('p','','dsm-status');panel.appendChild(status);list=element('div',undefined,'dsm-results');panel.appendChild(list);
    bar.appendChild(panel);header.parentNode.insertBefore(bar,header.nextSibling);
    nativeExpanded=expanded;opened=expanded;bar.hidden=!expanded;panel.hidden=!expanded;
    if(expanded)loadCatalog();
   }
   function removeLegacyUI() {
    // Remove only elements owned by old dsh-sidebar-marks versions.
    var obsolete=document.querySelectorAll('style[data-dsm-marks],style[data-dsm-hover-css],[data-dsm-hover]');
    for(var n=0;n<obsolete.length;n++)obsolete[n].remove();
    if(sidebar){
     var dots=sidebar.querySelectorAll('.dsm-dot,.dsm-spacer');
     for(var n=0;n<dots.length;n++)dots[n].remove();
    }
   }
   function decorate() {
    if(disposed)return;mount();removeLegacyUI();
    if(sidebar){
     var rows=sidebar.querySelectorAll('[class*="sessionRow"]');
     for(var i=0;i<rows.length;i++){
      var row=rows[i],id=sessionIdOf(row),kind=id?visibleKind(markFor(id)):null;
      var existing=row.querySelectorAll('[data-dsm-marker]');
      if(existing.length===1&&existing[0].getAttribute('data-kind')===kind&&existing[0].getAttribute('data-sid')===id)continue;
      for(var j=0;j<existing.length;j++)existing[j].remove();
      if(!kind)continue;
      var dot=element('span','', 'dsm-indicator');dot.setAttribute('data-dsm-marker','1');dot.setAttribute('data-kind',kind);dot.setAttribute('data-sid',id);dot.title=kind==='later'?'待回看':'收藏';
      var anchor=row.querySelector('[class*="pinIndicator"]')||row.querySelector('[class*="rowActions"]');
      if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(dot,anchor);else row.appendChild(dot);
     }
    }

   }
   async function refresh(){
    try {var data=await request('/marks');if(disposed)return;marks=data.sessions||{};decorate();if(opened)await loadCatalog()}
    catch(e){if(toggle)toggle.title='标记服务暂不可用，稍后重试'}
   }
   function schedule(){if(disposed||timer)return;timer=setTimeout(function(){timer=null;decorate()},100)}
   function escape(e){if(e.key==='Escape'&&opened)setOpen(false)}
   ctx.effect(function(){
    var unregisterMenu=ctx.contextMenus.register({
     id:'dsh-sidebar-marks.session-actions',target:'session',order:550,
     resolve:async function(target,signal){
      if(disposed||signal.aborted)return [];
      try {
       var data=await request('/marks');
       if(disposed||signal.aborted)return [];
       marks=data.sessions||{};decorate();
      } catch(e){return [{id:'unavailable',label:'会话标记暂不可用',disabled:true,separatorBefore:true}]}
      var id=target.sessionId;
      if(typeof id!=='string'||!id)return [];
      return [
       {id:'review',label:(has(id,'reviewLater')?'取消待回看':'待回看')+' · 会话标记',separatorBefore:true,disabled:busy.has(id),run:function(){return setMark(id,'reviewLater')}},
       {id:'favorite',label:(has(id,'favorite')?'取消收藏':'收藏')+' · 会话标记',disabled:busy.has(id),run:function(){return setMark(id,'favorite')}},
       {id:'delete',label:'删除会话 · 会话标记',danger:true,disabled:busy.has(id),run:function(){return removeSession(id,target.displayTitle)}}
      ];
     }
    });

    style=element('style');style.setAttribute('data-dsm-style','1');
    style.textContent=CSS;
    document.head.appendChild(style);
    observer=new MutationObserver(function(changes){
     for(var c=0;c<changes.length;c++){
      var change=changes[c];
      if(sidebar&&sidebar.contains(change.target)){schedule();return}
      var added=change.addedNodes||[];
      for(var j=0;j<added.length;j++){
       var node=added[j];if(node.nodeType!==1)continue;
       if(node.matches('aside,[class*="sidebarCol"],[class*="_hoverContent"]')||node.querySelector('aside,[class*="sidebarCol"],[class*="_hoverContent"]')){schedule();return}
      }
     }
    });observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-expanded']});
    document.addEventListener('keydown',escape);decorate();refresh();interval=setInterval(refresh,5000);
    return function(){
     disposed=true;unregisterMenu();generation++;clearTimeout(timer);clearInterval(interval);observer.disconnect();controllers.forEach(function(c){c.abort()});controllers.clear();
     document.removeEventListener('keydown',escape);if(bar)bar.remove();if(style)style.remove();
     var nodes=document.querySelectorAll('[data-dsm-marker],[data-dsm-hover]');for(var i=0;i<nodes.length;i++)nodes[i].remove();
    };
   });
  }
  var CSS=`
   .dsm-search{font:inherit;font-size:12px;padding:8px;margin:0 8px 8px;border-top:1px solid rgba(128,128,128,.3);box-sizing:border-box;color:inherit;flex:none}
   .dsm-search[hidden]{display:none!important}.dsm-search-label{font-size:11px;opacity:.65;margin-bottom:6px}
   .dsm-button{font:inherit;color:inherit;background:transparent;border:1px solid transparent;border-radius:5px;padding:4px 7px;cursor:pointer;white-space:nowrap}
   .dsm-button:hover{background:rgba(128,128,128,.12)}
   .dsm-search-toggle{opacity:.75}.dsm-panel[hidden]{display:none!important}
   .dsm-panel{padding-top:7px}.dsm-tabs{display:flex;gap:4px;margin-bottom:6px}.dsm-button[aria-pressed=true]{background:rgba(128,128,128,.2);opacity:1}
   .dsm-panel input{font:inherit;color:inherit;width:100%;box-sizing:border-box;background:transparent;border:1px solid rgba(128,128,128,.35);border-radius:5px;padding:5px 7px}
   .dsm-status,.dsm-empty{font-size:11px;opacity:.65;margin:6px 0}.dsm-results{max-height:300px;overflow:auto}
   .dsm-result{display:grid;grid-template-columns:6px minmax(0,1fr);gap:5px 8px;text-align:left;width:100%;padding:7px;border:0;background:transparent;color:inherit;cursor:pointer;border-radius:5px}
   .dsm-result:hover{background:rgba(128,128,128,.12)}.dsm-result-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsm-workspace{grid-column:2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.55}
   .dsm-indicator{display:inline-block;width:6px;height:6px;border-radius:50%;flex-shrink:0;align-self:center;margin:0 6px}
   .dsm-indicator[data-kind=later]{background:#ec7a70}.dsm-indicator[data-kind=favorite]{background:#d9a94e}
   .dsm-actions{display:flex;align-items:center;gap:4px;border-top:1px solid rgba(128,128,128,.2);padding-top:7px;margin-top:7px;font-size:12px}
   .dsm-delete{margin-left:auto;opacity:.65}.dsm-delete:hover{color:#e06c75}.dsm-button:disabled{opacity:.4;cursor:wait}
  `;
  return {apply:apply,inject:['sessions','uiWorkspace','contextMenus'],__test:{visibleKind:visibleKind,sessionIdOf:sessionIdOf}};
 }
});
