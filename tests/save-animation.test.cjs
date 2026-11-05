const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');
const start = source.indexOf('  function applySaveAnimationBehavior(');
const end = source.indexOf('\n  let timerSaveInProgress', start);
const context = vm.createContext({ Math, elapsedMs:t=>t.elapsed, planMultiBar:total=>({total}) });
vm.runInContext(source.slice(start,end),context);
const apply = context.applySaveAnimationBehavior;
test('duration continues elapsed time and fired reminders across a save',()=>{
  const old = {elapsed:2500, _firedMap:{a:true}, _kMap:{b:1}};
  const timer = {mode:'duration', duration:10000};
  apply(timer,old,'continue',20000);
  assert.equal(timer.start,17500);
  assert.equal(timer.total0,10000);
  assert.equal(timer._prevRem,7500);
  assert.equal(timer._firedMap.a,true);
  assert.notEqual(timer._firedMap,old._firedMap);
});
test('reset clears completion and reminders while a paused timer stays paused',()=>{
  const timer = {mode:'duration',duration:6000};
  apply(timer,{elapsed:6000,paused:true,completed:true,_firedMap:{a:true}},'reset',20000);
  assert.equal(timer.start,20000);
  assert.equal(timer.completed,false);
  assert.equal(timer.leftWhenPaused,6000);
  assert.equal(timer.pausedAt,20000);
  assert.equal(Object.keys(timer._firedMap).length,0);
});
test('target timer retains its end and elapsed animation origin',()=>{
  const timer = {mode:'datetime',targetMs:30000};
  apply(timer,{elapsed:4000},'continue',20000);
  assert.equal(timer.start,16000);
  assert.equal(timer.targetMs,30000);
  assert.equal(timer.total0,14000);
});
test('completed duration remains completed on continue and can be extended',()=>{
  for (const duration of [10000,15000]) {
    const timer={mode:'duration',duration};
    apply(timer,{elapsed:10000,completed:true},'continue',20000);
    assert.equal(timer.completed,duration===10000);
  }
});
