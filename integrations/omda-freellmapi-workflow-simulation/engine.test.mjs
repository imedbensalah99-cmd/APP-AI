import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlan } from '../omda-freellmapi-workflow-studio/engine.mjs';
import { simulatePlan, exportJSON, exportCSV } from './engine.mjs';

function step(id, title, dependsOn = [], extra = {}) {
  return {
    id, kind: 'general', title, status: 'todo', dependsOn,
    approvalRequired: false, approved: false, execution: 'manual', note: '',
    ...extra
  };
}
function customPlan(steps) {
  return {
    schemaVersion: 1, command: 'Simulation test plan', mode: 'PLAN_ONLY',
    networkCalls: 0, paidCalls: 0, generatedAt: null, steps
  };
}

test('schedules independent tasks across bounded worker lanes', () => {
  const plan = customPlan([
    step('general-1', 'One'), step('general-2', 'Two'), step('general-3', 'Three')
  ]);
  const result = simulatePlan(plan, { concurrency: 2, defaultMinutes: 10 });
  assert.equal(result.summary.makespanMinutes, 20);
  assert.equal(result.summary.criticalPathMinutes, 10);
  assert.equal(result.summary.totalWorkMinutes, 30);
  assert.equal(result.summary.utilizationPercent, 75);
  assert.equal(result.tasks.filter(task => task.state === 'SCHEDULED').length, 3);
  assert.equal(result.simulationOnly, true);
  assert.equal(result.executionStarted, false);
});
test('respects dependency completion before scheduling downstream work', () => {
  const plan = customPlan([
    step('general-1', 'Prepare'),
    step('general-2', 'Review', ['general-1']),
    step('general-3', 'Package', ['general-2'])
  ]);
  const result = simulatePlan(plan, {
    concurrency: 3, defaultMinutes: 12,
    durations: { 'general-1': 5, 'general-2': 7, 'general-3': 2 }
  });
  const byId = new Map(result.tasks.map(task => [task.id, task]));
  assert.ok(byId.get('general-2').startMinute >= byId.get('general-1').endMinute);
  assert.ok(byId.get('general-3').startMinute >= byId.get('general-2').endMinute);
  assert.equal(result.summary.makespanMinutes, 14);
  assert.equal(result.summary.criticalPathMinutes, 14);
});
test('models approval wait as a dependency hold without occupying a worker lane', () => {
  const plan = customPlan([
    step('general-1', 'Prepare'),
    step('general-2', 'Approval gate', ['general-1'], { approvalRequired: true }),
    step('general-3', 'Continue', ['general-2'])
  ]);
  const result = simulatePlan(plan, {
    concurrency: 2, defaultMinutes: 5, approvalWaitMinutes: 8
  });
  const gate = result.tasks.find(task => task.id === 'general-2');
  const next = result.tasks.find(task => task.id === 'general-3');
  assert.equal(gate.workEndMinute, 10);
  assert.equal(gate.endMinute, 18);
  assert.ok(next.startMinute >= 18);
  assert.equal(result.summary.totalReviewWaitMinutes, 8);
  assert.equal(result.executionStarted, false);
});
test('propagates blocked prerequisites to dependent tasks', () => {
  const plan = customPlan([
    step('general-1', 'Blocked source', [], { status: 'blocked' }),
    step('general-2', 'Dependent', ['general-1']),
    step('general-3', 'Independent')
  ]);
  const result = simulatePlan(plan, { concurrency: 2, defaultMinutes: 10 });
  assert.equal(result.summary.blockedCount, 2);
  assert.equal(result.summary.scheduledCount, 1);
  assert.equal(result.tasks.find(task => task.id === 'general-2').state, 'BLOCKED');
  assert.equal(result.tasks.find(task => task.id === 'general-3').state, 'SCHEDULED');
});
test('treats completed steps as already finished and preserves source plan', () => {
  const plan = makePlan('Create document');
  const changed = {
    ...plan,
    steps: plan.steps.map((item, index) => index === 0 ? { ...item, status: 'done' } : item)
  };
  const before = JSON.stringify(changed);
  const result = simulatePlan(changed, { concurrency: 2, defaultMinutes: 6 });
  assert.equal(JSON.stringify(changed), before);
  assert.equal(result.summary.completedCount, 1);
  assert.equal(result.tasks.find(task => task.id === changed.steps[0].id).endMinute, 0);
});
test('rejects unknown keys, unsupported modes, and malformed plan shapes', () => {
  const plan = makePlan('Create document');
  assert.throws(() => simulatePlan({ ...plan, extra: true }), /keys/);
  assert.throws(() => simulatePlan({ ...plan, mode: 'EXECUTE' }), /Unsupported/);
  assert.throws(() => simulatePlan({
    ...plan, steps: plan.steps.map((item, index) => index ? item : { ...item, note: 'x'.repeat(241) })
  }), /metadata/);
  assert.throws(() => simulatePlan({ ...plan, steps: [] }), /Unsupported/);
});
test('enforces concurrency, duration, approval wait, and duration-map bounds', () => {
  const plan = makePlan('Create document');
  assert.throws(() => simulatePlan(plan, { concurrency: 0 }), /concurrency/);
  assert.throws(() => simulatePlan(plan, { concurrency: 5 }), /concurrency/);
  assert.throws(() => simulatePlan(plan, { defaultMinutes: 1441 }), /default duration/);
  assert.throws(() => simulatePlan(plan, { approvalWaitMinutes: 721 }), /approval wait/);
  assert.throws(() => simulatePlan(plan, { durations: { unknown: 5 } }), /Unknown/);
  assert.throws(() => simulatePlan(plan, { durations: { [plan.steps[0].id]: 0 } }), /task duration/);
  assert.throws(() => simulatePlan(plan, { unexpected: true }), /Unknown simulation option/);
});
test('exports bounded JSON and formula-neutralized CSV', () => {
  const plan = customPlan([step('general-1', '=HYPERLINK("https://invalid.example")')]);
  const result = simulatePlan(plan, { defaultMinutes: 5 });
  assert.deepEqual(JSON.parse(exportJSON(result)), result);
  const csv = exportCSV(result);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /\r\n/);
});
test('Workflow Studio plans remain compatible without modifying the source engine', () => {
  const plan = makePlan('Create a website and prepare an email draft');
  const result = simulatePlan(plan, { concurrency: 2, defaultMinutes: 15, approvalWaitMinutes: 10 });
  assert.equal(result.summary.totalSteps, plan.steps.length);
  assert.ok(result.tasks.some(task => task.approvalGate));
  assert.equal(result.networkCalls, 0);
  assert.equal(result.paidCalls, 0);
});
