import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlan,detectWork,updateStep,summary,validatePlan,exportJSON,MAX_INPUT,MAX_STEPS} from './engine.mjs';

test('creates multiple independent workstreams in Arabic and English',()=>{
  const p=makePlan('اعمل ويبسايت وجدول إكسل and an email draft');
  assert.deepEqual([...new Set(p.steps.map(s=>s.kind))],['website','spreadsheet','email']);
  assert.equal(p.mode,'PLAN_ONLY');assert.equal(p.networkCalls,0);assert.equal(p.paidCalls,0);
  assert.ok(p.steps.some(s=>s.approvalRequired));assert.ok(p.steps.every(s=>s.execution==='manual'));
});
test('never claims external action took place',()=>{
  const plan=makePlan('Find jobs and send email');
  assert.equal(plan.steps.at(-1).approvalRequired,true);
  assert.ok(!Object.hasOwn(plan,'executedActions'));
});
test('bounded input and deterministic work plan',()=>{
  assert.deepEqual(makePlan('Generate website'),makePlan('Generate website'));
  assert.throws(()=>makePlan('a'),/Invalid/);
  assert.throws(()=>makePlan('x'.repeat(MAX_INPUT+1)),/Invalid/);
  assert.throws(()=>makePlan('hello\u0001world'),/Invalid/);
  assert.ok(makePlan('Generate website excel pdf email jobs and code').steps.length<=MAX_STEPS);
  assert.equal(detectWork('فكرة جديدة')[0].kind,'general');
});
test('dependencies are enforced and state is immutable',()=>{
  const plan=makePlan('build website');
  assert.throws(()=>updateStep(plan,'website-2','doing'),/prerequisite/);
  const first=updateStep(plan,'website-1','done');
  assert.equal(plan.steps[0].status,'todo');
  const second=updateStep(first,'website-2','doing');
  assert.equal(second.steps[1].status,'doing');
  assert.equal(summary(second).done,1);
  assert.equal(summary(second).doing,1);
});
test('protected actions need approval and never actually execute',()=>{
  let plan=makePlan('send email');
  for(const s of plan.steps.slice(0,-1))plan=updateStep(plan,s.id,'done');
  const final=plan.steps.at(-1);
  assert.throws(()=>updateStep(plan,final.id,'done'),/approval/);
  const reviewed=updateStep(plan,final.id,'done',{approve:true});
  assert.equal(reviewed.steps.at(-1).approved,true);
  assert.equal(summary(reviewed).percent,100);
  assert.equal(reviewed.mode,'PLAN_ONLY');
});
test('rejects malformed or cyclic/corrupted imported plans',()=>{
  const p=makePlan('job search');
  assert.throws(()=>validatePlan({...p,schemaVersion:9}),/Invalid/);
  assert.throws(()=>validatePlan({...p,mode:'EXECUTE'}),/Invalid/);
  assert.throws(()=>validatePlan({...p,steps:[p.steps[1],p.steps[0]]}),/Dependencies/);
  assert.throws(()=>validatePlan({...p,steps:[...p.steps,p.steps[0]]}),/Invalid/);
  assert.throws(()=>updateStep(p,'wrong','done'),/Unknown/);
  assert.throws(()=>updateStep(p,p.steps[0].id,'shipped'),/Invalid/);
});
test('safe export round trip and progress',()=>{
  const p=makePlan('Create PDF report');
  const s=exportJSON(p);
  assert.deepEqual(JSON.parse(s),p);
  assert.deepEqual(summary(p),{todo:3,doing:0,done:0,blocked:0,total:3,percent:0});
});
