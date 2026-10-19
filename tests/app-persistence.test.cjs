// >_ save means saved · 写入失败就明确报出来，别给“已保存”假象 💾
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('  function save() {');
const source=html.slice(start,html.indexOf('  function ask(message)',start));
function context(storage,raw='old') {
  const ui={textContent:'previous',hidden:true};const notices=[];
  const c={syncEngine:null,localUnsaved:false,persistent:true,lastRaw:raw,KEY:'budget',state:{value:1},localStorage:storage,JSON,
    $:()=>ui,toast:()=>{},storageNotice:s=>notices.push(s)};
  vm.createContext(c);vm.runInContext(source,c);
  return {c,ui,notices};
}
test('local quota error reports unsaved and never changes stored data',()=>{
  const h=context({getItem:()=> 'old',setItem:()=>{throw new Error('quota');}});
  assert.equal(h.c.save(),false);assert.equal(h.c.localUnsaved,true);assert.equal(h.c.lastRaw,'old');assert.equal(h.ui.textContent,'previous');assert.match(h.notices[0],/尚未保存/);
});
test('local save success requires a matching read-back',()=>{
  let raw='old';const h=context({getItem:()=>raw,setItem:(_k,v)=>raw=v});
  assert.equal(h.c.save(),true);assert.equal(h.c.localUnsaved,false);assert.equal(h.ui.textContent,'本地已保存');assert.equal(raw,JSON.stringify({value:1}));
});
test('other local tab changes stop the write instead of overwriting',()=>{
  let wrote=false;const h=context({getItem:()=> 'other-tab',setItem:()=>wrote=true});
  assert.equal(h.c.save(),false);assert.equal(wrote,false);assert.equal(h.c.persistent,false);assert.equal(h.c.localUnsaved,true);
});
test('a rejected cloud stage remains unsaved',()=>{
  const h=context({getItem:()=> 'old',setItem:()=>{throw new Error('must not write legacy');}});
  h.c.syncEngine={userId:'alice',stage:()=>{throw new Error('NOT_READY');}};
  assert.equal(h.c.save(),false);
  assert.equal(h.c.localUnsaved,true);
});
