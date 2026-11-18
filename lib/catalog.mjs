// Only session metadata and explicit user marks; never reads conversation bodies.
export function visibleKind(mark) {
 const kinds=mark?.marks||[];
 return mark?.reviewLater===true||kinds.includes('later')?'later':mark?.favorite===true||kinds.includes('favorite')?'favorite':null;
}
export function buildCatalog(raw,cached,marks,filter='all',query='') {
 if(!Array.isArray(raw)) throw new Error('unsupported-session-index');
 if(!['all','later','favorite'].includes(filter)) throw new Error('bad-filter');
 const index=new Map();
 for(const value of [...raw,...cached]) {
  const h=value?.header||value;
  if(!h || typeof h.id!=='string') continue;
  const previous=index.get(h.id)||{};
  const title=h.title||value.title||value.state?.title||value.snapshot?.title||previous.title||'未命名会话';
  index.set(h.id,{id:h.id,title:String(title),workspace:String(h.cwd||value.cwd||previous.workspace||'未知工作区')});
 }
 // Cached-only, deleted sessions must not be resurrected in the search results.
 const durable=new Set(raw.map(v=>(v?.header||v)?.id));
 const needle=String(query).trim().toLocaleLowerCase();
 return [...index.values()].filter(item=>{
  if(!durable.has(item.id)) return false;
  const m=marks[item.id];const kind=visibleKind(m);if(!kind)return false;
  if(filter==='later' && !(m?.reviewLater===true||m?.marks?.includes('later')))return false;
  if(filter==='favorite' && !(m?.favorite===true||m?.marks?.includes('favorite')))return false;
  return !needle || item.title.toLocaleLowerCase().includes(needle);
 }).map(item=>({...item,kind:visibleKind(marks[item.id])})).sort((a,b)=>a.title.localeCompare(b.title));
}
