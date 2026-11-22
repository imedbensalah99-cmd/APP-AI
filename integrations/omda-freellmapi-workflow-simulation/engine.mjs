// OMDA Workflow Simulation Lab — deterministic, offline-only scheduler.
// Estimates a plan; it never executes tasks, calls providers, or contacts services.
import { validatePlan } from '../omda-freellmapi-workflow-studio/engine.mjs';

const MAX_STEPS = 24;
const MAX_PLAN_BYTES = 128 * 1024;
const MAX_DURATION_MINUTES = 1440;
const MAX_APPROVAL_WAIT_MINUTES = 720;
const PLAN_KEYS = ['command','generatedAt','mode','networkCalls','paidCalls','schemaVersion','steps'];
const STEP_KEYS = ['approved','approvalRequired','dependsOn','execution','id','kind','note','status','title'];

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = expected.slice().sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError('Invalid ' + label + ' keys');
  }
}
function boundedInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError('Invalid ' + label);
  }
  return value;
}
function validateSimulationPlan(plan) {
  if (!isPlainObject(plan)) throw new TypeError('Invalid plan object');
  exactKeys(plan, PLAN_KEYS, 'plan');
  if (plan.schemaVersion !== 1 || plan.mode !== 'PLAN_ONLY' ||
      typeof plan.command !== 'string' || plan.command.trim().length < 3 ||
      plan.command.length > 2000 || /[\u0000-\u001f]/u.test(plan.command) ||
      plan.networkCalls !== 0 || plan.paidCalls !== 0 ||
      !(plan.generatedAt === null || (typeof plan.generatedAt === 'string' && plan.generatedAt.length <= 64)) ||
      !Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > MAX_STEPS) {
    throw new TypeError('Unsupported Workflow Studio plan');
  }
  for (const step of plan.steps) {
    if (!isPlainObject(step)) throw new TypeError('Invalid plan step');
    exactKeys(step, STEP_KEYS, 'step');
    if (typeof step.note !== 'string' || step.note.length > 240 ||
        typeof step.kind !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/u.test(step.kind)) {
      throw new TypeError('Invalid plan step metadata');
    }
  }
  validatePlan(plan);
  return plan;
}
function normalizeOptions(options, ids) {
  if (options === undefined) options = {};
  if (!isPlainObject(options)) throw new TypeError('Invalid simulation options');
  const allowed = new Set(['concurrency','defaultMinutes','approvalWaitMinutes','durations']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new TypeError('Unknown simulation option');
  }
  const concurrency = boundedInteger(options.concurrency ?? 2, 1, 4, 'concurrency');
  const defaultMinutes = boundedInteger(options.defaultMinutes ?? 30, 1, MAX_DURATION_MINUTES, 'default duration');
  const approvalWaitMinutes = boundedInteger(options.approvalWaitMinutes ?? 0, 0, MAX_APPROVAL_WAIT_MINUTES, 'approval wait');
  const durations = options.durations ?? {};
  if (!isPlainObject(durations)) throw new TypeError('Invalid task durations');
  for (const [id, value] of Object.entries(durations)) {
    if (!ids.has(id)) throw new TypeError('Unknown task duration ID');
    boundedInteger(value, 1, MAX_DURATION_MINUTES, 'task duration');
  }
  return { concurrency, defaultMinutes, approvalWaitMinutes, durations };
}
function simulatePlan(plan, options) {
  validateSimulationPlan(plan);
  const ids = new Set(plan.steps.map(step => step.id));
  const config = normalizeOptions(options, ids);
  const indexById = new Map(plan.steps.map((step, index) => [step.id, index]));
  const blocked = new Set(plan.steps.filter(step => step.status === 'blocked').map(step => step.id));
  for (const step of plan.steps) {
    if (step.dependsOn.some(id => blocked.has(id))) blocked.add(step.id);
  }

  const finishAt = new Map();
  const workerAvailable = Array.from({ length: config.concurrency }, () => 0);
  const scheduled = new Map();
  const pending = [];
  for (const step of plan.steps) {
    if (step.status === 'done') {
      finishAt.set(step.id, 0);
      scheduled.set(step.id, {
        id: step.id, title: step.title, state: 'COMPLETED', lane: null,
        startMinute: 0, workEndMinute: 0, endMinute: 0,
        workMinutes: 0, approvalWaitMinutes: 0, approvalGate: step.approvalRequired,
        sequence: indexById.get(step.id)
      });
    } else if (blocked.has(step.id)) {
      scheduled.set(step.id, {
        id: step.id, title: step.title, state: 'BLOCKED', lane: null,
        startMinute: null, workEndMinute: null, endMinute: null,
        workMinutes: 0, approvalWaitMinutes: 0, approvalGate: step.approvalRequired,
        sequence: indexById.get(step.id)
      });
    } else {
      pending.push(step);
    }
  }

  let time = 0;
  let iterations = 0;
  while (pending.length > 0) {
    const ready = pending.filter(step =>
      step.dependsOn.every(id => finishAt.has(id) && finishAt.get(id) <= time)
    ).sort((a, b) => indexById.get(a.id) - indexById.get(b.id));
    const freeWorkers = workerAvailable
      .map((availableAt, index) => ({ availableAt, index }))
      .filter(worker => worker.availableAt <= time)
      .sort((a, b) => a.availableAt - b.availableAt || a.index - b.index);

    let assigned = 0;
    for (const worker of freeWorkers) {
      const step = ready.shift();
      if (!step) break;
      const workMinutes = config.durations[step.id] ?? config.defaultMinutes;
      const approvalWaitMinutes = step.approvalRequired ? config.approvalWaitMinutes : 0;
      const startMinute = time;
      const workEndMinute = startMinute + workMinutes;
      const endMinute = workEndMinute + approvalWaitMinutes;
      scheduled.set(step.id, {
        id: step.id, title: step.title, state: 'SCHEDULED', lane: worker.index + 1,
        startMinute, workEndMinute, endMinute, workMinutes, approvalWaitMinutes,
        approvalGate: step.approvalRequired, sequence: indexById.get(step.id)
      });
      workerAvailable[worker.index] = workEndMinute;
      finishAt.set(step.id, endMinute);
      pending.splice(pending.findIndex(item => item.id === step.id), 1);
      assigned++;
    }
    if (pending.length === 0) break;
    if (assigned > 0) continue;
    const futureTimes = workerAvailable.filter(value => value > time);
    for (const value of finishAt.values()) if (value > time) futureTimes.push(value);
    if (futureTimes.length === 0) throw new Error('Unable to resolve task dependencies');
    time = Math.min(...futureTimes);
    iterations++;
    if (iterations > MAX_STEPS * 4) throw new Error('Simulation iteration limit reached');
  }

  const tasks = Array.from(scheduled.values()).sort((a, b) =>
    (a.startMinute ?? Number.MAX_SAFE_INTEGER) - (b.startMinute ?? Number.MAX_SAFE_INTEGER) ||
    a.sequence - b.sequence
  );
  const pathEnd = new Map();
  for (const step of plan.steps) {
    if (blocked.has(step.id)) {
      pathEnd.set(step.id, null);
    } else if (step.status === 'done') {
      pathEnd.set(step.id, 0);
    } else {
      let prerequisiteEnd = 0;
      for (const id of step.dependsOn) prerequisiteEnd = Math.max(prerequisiteEnd, pathEnd.get(id) ?? 0);
      const work = config.durations[step.id] ?? config.defaultMinutes;
      const review = step.approvalRequired ? config.approvalWaitMinutes : 0;
      pathEnd.set(step.id, prerequisiteEnd + work + review);
    }
  }

  const activeTasks = tasks.filter(task => task.state === 'SCHEDULED');
  const makespanMinutes = activeTasks.reduce((max, task) => Math.max(max, task.endMinute), 0);
  const totalWorkMinutes = activeTasks.reduce((sum, task) => sum + task.workMinutes, 0);
  const totalReviewWaitMinutes = activeTasks.reduce((sum, task) => sum + task.approvalWaitMinutes, 0);
  const criticalPathMinutes = Math.max(0, ...Array.from(pathEnd.values()).filter(value => value !== null));
  const blockedCount = tasks.filter(task => task.state === 'BLOCKED').length;
  const completedCount = tasks.filter(task => task.state === 'COMPLETED').length;
  const utilizationPercent = makespanMinutes === 0
    ? 0
    : Math.round((totalWorkMinutes / (makespanMinutes * config.concurrency)) * 100);
  const warnings = [];
  if (blockedCount > 0) warnings.push('Blocked tasks and their dependants were excluded from the schedule.');
  if (makespanMinutes > criticalPathMinutes) warnings.push('Worker contention adds time beyond the dependency critical path.');
  if (totalReviewWaitMinutes > 0) warnings.push('Approval wait is an estimate only; no approval is requested or recorded.');

  return {
    schemaVersion: 1, mode: 'SIMULATION_ONLY', simulationOnly: true,
    executionStarted: false, networkCalls: 0, paidCalls: 0,
    assumptions: {
      concurrency: config.concurrency, defaultMinutes: config.defaultMinutes,
      approvalWaitMinutes: config.approvalWaitMinutes,
      customDurationCount: Object.keys(config.durations).length
    },
    summary: {
      totalSteps: plan.steps.length, scheduledCount: activeTasks.length,
      completedCount, blockedCount, totalWorkMinutes, totalReviewWaitMinutes,
      makespanMinutes, criticalPathMinutes,
      concurrencyOverheadMinutes: Math.max(0, makespanMinutes - criticalPathMinutes),
      utilizationPercent
    },
    warnings, tasks
  };
}
function csvCell(value) {
  const raw = String(value ?? '');
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(raw) ? "'" + raw : raw;
  return '"' + safe.replace(/"/gu, '""') + '"';
}
function exportCSV(result) {
  if (!result || result.mode !== 'SIMULATION_ONLY' || !Array.isArray(result.tasks)) {
    throw new TypeError('Invalid simulation result');
  }
  const rows = [[
    'ID','Task','State','Lane','Start minute','Work end minute','Finish minute',
    'Work minutes','Approval wait minutes','Approval gate'
  ]];
  for (const task of result.tasks) {
    rows.push([
      task.id, task.title, task.state, task.lane ?? '', task.startMinute ?? '',
      task.workEndMinute ?? '', task.endMinute ?? '', task.workMinutes,
      task.approvalWaitMinutes, task.approvalGate ? 'Yes' : 'No'
    ]);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function exportJSON(result) {
  if (!result || result.mode !== 'SIMULATION_ONLY' || !Array.isArray(result.tasks)) {
    throw new TypeError('Invalid simulation result');
  }
  return JSON.stringify(result, null, 2) + '\n';
}
export {
  simulatePlan, validateSimulationPlan, exportJSON, exportCSV,
  MAX_STEPS, MAX_PLAN_BYTES, MAX_DURATION_MINUTES, MAX_APPROVAL_WAIT_MINUTES
};
