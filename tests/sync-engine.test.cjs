const {test} = require('node:test');
const assert = require('node:assert/strict');
const {BudgetSyncEngine} = require('../src/sync-engine.js');
const state = n => ({version:1,budget:n,items:[]});
const copy = x => JSON.parse(JSON.stringify(x));
function storage() {
  const data = new Map();
  return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),data};
}
function harness({store=storage(), row=null, offline=false}={}) {
  const backend={row,offline,writes:0};
  const statuses=[];
  const make=()=>new BudgetSyncEngine({storage:store,delay:100000,
    validate:p=>p?.version===1&&Number.isSafeInteger(p.budget)&&Array.isArray(p.items),
    emptyState:()=>state(0),onStatus:s=>statuses.push(s),
    readRemote:async()=>{if(backend.offline)throw new Error('OFFLINE');return copy(backend.row);},
    writeRemote:async({payload,revision})=>{
      if(backend.offline)throw new Error('OFFLINE');
      if((backend.row?.revision??null)!==revision)return {conflict:true};
      backend.writes++;backend.row={payload:copy(payload),revision:revision===null?0:revision+1};
      return {revision:backend.row.revision};
    }});
  return {engine:make(),make,store,backend,statuses};
}
test('new account never uploads demo or empty defaults on startup',async()=>{
  const h=harness();await h.engine.activate('alice');assert.equal(h.backend.writes,0);
  assert.deepEqual(h.engine.entry.payload,state(0));assert.equal(h.engine.kind,'empty');h.engine.deactivate();
});
test('cloud is loaded before edits are allowed',async()=>{
  const h=harness({row:{payload:state(800),revision:4}});await h.engine.activate('alice');
  assert.equal(h.engine.entry.payload.budget,800);h.engine.stage(state(900));await h.engine.flush();
  assert.equal(h.backend.row.payload.budget,900);assert.equal(h.backend.row.revision,5);assert.equal(h.engine.kind,'synced');h.engine.deactivate();
});
test('failed read without cache cannot create or overwrite a remote record',async()=>{
  const h=harness({offline:true});await h.engine.activate('alice');
  assert.equal(h.engine.ready,false);assert.equal(h.engine.kind,'read-error');assert.throws(()=>h.engine.stage(state(100)),/NOT_READY/);assert.equal(h.backend.writes,0);h.engine.deactivate();
});
test('offline pending edits survive engine restart and later reconnect',async()=>{
  const h=harness({row:{payload:state(100),revision:1}});await h.engine.activate('alice');h.backend.offline=true;
  h.engine.stage(state(200));await h.engine.flush();assert.equal(h.engine.kind,'pending-error');h.engine.deactivate();
  const second=h.make();await second.activate('alice');assert.equal(second.entry.payload.budget,200);assert.equal(second.entry.dirty,true);
  h.backend.offline=false;await second.retry();assert.equal(second.kind,'synced');assert.equal(h.backend.row.payload.budget,200);second.deactivate();
});
test('two devices with a stale revision enter conflict instead of overwriting',async()=>{
  const h=harness({row:{payload:state(100),revision:2}}),b=h.make();await h.engine.activate('alice');await b.activate('alice');
  h.engine.stage(state(200));await h.engine.flush();b.stage(state(300));await b.flush();
  assert.equal(b.kind,'conflict');assert.equal(h.backend.row.payload.budget,200);assert.equal(b.entry.payload.budget,300);
  await b.useRemote();assert.equal(b.entry.payload.budget,200);assert.ok(h.store.getItem('double11-cloud-v1:alice:conflict-recovery'));
  h.engine.deactivate();b.deactivate();
});
test('explicit keep local still uses a guarded versioned write',async()=>{
  const h=harness({row:{payload:state(100),revision:0}});await h.engine.activate('alice');h.engine.stage(state(300));h.backend.row={payload:state(200),revision:1};
  await h.engine.flush();assert.equal(h.engine.kind,'conflict');await h.engine.keepLocal();assert.equal(h.backend.row.payload.budget,300);assert.equal(h.backend.row.revision,2);h.engine.deactivate();
});
test('edits arriving during an in-flight save are not lost',async()=>{
  const h=harness({row:{payload:state(100),revision:0}});await h.engine.activate('alice');
  const original=h.engine.options.writeRemote;let release,started;const start=new Promise(r=>started=r);let first=true;
  h.engine.options.writeRemote=async args=>{if(first){first=false;started();await new Promise(r=>release=r);}return original(args);};
  h.engine.stage(state(200));const flushing=h.engine.flush();await start;h.engine.stage(state(300));release();await flushing;
  assert.equal(h.backend.row.payload.budget,300);assert.equal(h.backend.row.revision,2);assert.equal(h.engine.entry.dirty,false);h.engine.deactivate();
});
test('account switch ignores old async reads and isolates account caches',async()=>{
  const h=harness();let release;
  h.engine.options.readRemote=async id=>id==='alice'?new Promise(r=>release=r):{payload:state(900),revision:0};
  const first=h.engine.activate('alice');await h.engine.activate('bob');release({payload:state(100),revision:0});await first;
  assert.equal(h.engine.userId,'bob');assert.equal(h.engine.entry.payload.budget,900);assert.equal(h.store.getItem('double11-cloud-v1:alice'),null);h.engine.deactivate();
});
test('quota error reports unsaved local edits, never local save success',async()=>{
  const h=harness({row:{payload:state(100),revision:0}});await h.engine.activate('alice');h.store.setItem=()=>{throw new Error('QUOTA');};h.backend.offline=true;
  assert.equal(h.engine.stage(state(200)),false);assert.equal(h.engine.kind,'pending-uncached');await h.engine.flush();
  assert.equal(h.engine.kind,'pending-uncached');assert.equal(h.engine.needsUnloadWarning(),true);h.engine.deactivate();
});
test('malformed remote cannot overwrite a valid cached record',async()=>{
  const h=harness({row:{payload:state(100),revision:0}});await h.engine.activate('alice');h.backend.row={payload:{bad:true},revision:1};await h.engine.refresh();
  assert.equal(h.engine.kind,'read-error');assert.equal(h.engine.entry.payload.budget,100);h.engine.deactivate();
});
test('another tab cannot erase an offline pending cache',async()=>{
  const h=harness({row:{payload:state(100),revision:0}}),b=h.make();await h.engine.activate('alice');await b.activate('alice');
  h.backend.offline=true;h.engine.stage(state(200));b.stage(state(300));
  assert.equal(b.cached,false);assert.equal(JSON.parse(h.store.getItem('double11-cloud-v1:alice')).payload.budget,200);
  h.engine.deactivate();b.deactivate();
});
