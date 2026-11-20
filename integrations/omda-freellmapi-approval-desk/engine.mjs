// OMDA Approval Desk — offline review receipts for Workflow Studio plans.
// This module records review decisions only. It never executes external actions.
export const MAX_PLAN_BYTES = 128 * 1024;
export const MAX_STEPS = 24;
export const MAX_NOTE_CHARS = 240;
const PLAN_KEYS = ['schemaVersion', 'command', 'mode', 'networkCalls', 'paidCalls', 'generatedAt', 'steps'];
const STEP_KEYS = ['id', 'kind', 'title', 'status', 'dependsOn', 'approvalRequired', 'approved', 'execution', 'note'];
const PACKET_KEYS = ['schemaVersion', 'planDigest', 'createdAt', 'decisions'];
const DECISION_KEYS = ['stepId', 'decision', 'decidedAt', 'reviewerNote'];
const STATUSES = new Set(['todo', 'doing', 'done', 'blocked']);
const DECISIONS = new Set(['pending', 'approved', 'rejected']);
const PROTECTED_KINDS = new Set(['website', 'email', 'jobs', 'code']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasExactKeys(value, expected) {
  return isRecord(value) && Object.keys(value).sort().join('|') === [...expected].sort().join('|');
}
function isIsoDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function hasControlChars(value) {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

export function validatePlan(plan) {
  if (!hasExactKeys(plan, PLAN_KEYS) || plan.schemaVersion !== 1 || plan.mode !== 'PLAN_ONLY' ||
      plan.networkCalls !== 0 || plan.paidCalls !== 0 || typeof plan.command !== 'string' ||
      plan.command.trim().length < 3 || plan.command.length > 2000 || hasControlChars(plan.command) ||
      !(plan.generatedAt === null || isIsoDate(plan.generatedAt)) ||
      !Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > MAX_STEPS) {
    throw new Error('Invalid Workflow Studio plan envelope');
  }

  const ids = new Set();
  const statuses = new Map();
  const lastIndexByKind = new Map();
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    if (!hasExactKeys(step, STEP_KEYS) || typeof step.id !== 'string' ||
        !/^[a-z][a-z0-9_-]{0,39}-[1-9][0-9]?$/.test(step.id) || ids.has(step.id) ||
        typeof step.kind !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(step.kind) ||
        typeof step.title !== 'string' || step.title.trim().length < 1 || step.title.length > 140 ||
        hasControlChars(step.title) || !STATUSES.has(step.status) ||
        !Array.isArray(step.dependsOn) || step.dependsOn.length > MAX_STEPS ||
        step.dependsOn.some(dep => typeof dep !== 'string') ||
        new Set(step.dependsOn).size !== step.dependsOn.length ||
        typeof step.approvalRequired !== 'boolean' || typeof step.approved !== 'boolean' ||
        step.execution !== 'manual' || typeof step.note !== 'string' || step.note.length > 200 ||
        hasControlChars(step.note)) {
      throw new Error(`Invalid plan step at index ${i}`);
    }
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) throw new Error('Dependencies must refer to earlier steps');
    }
    if ((step.status === 'doing' || step.status === 'done') &&
        step.dependsOn.some(dep => statuses.get(dep) !== 'done')) {
      throw new Error('A step cannot advance before its prerequisites are done');
    }
    if (step.approved && !step.approvalRequired) throw new Error('Only protected steps may be marked approved');
    if (step.approvalRequired && step.status === 'done' && !step.approved) {
      throw new Error('Completed protected steps must carry their plan approval flag');
    }
    ids.add(step.id);
    statuses.set(step.id, step.status);
    lastIndexByKind.set(step.kind, i);
  }

  for (const kind of PROTECTED_KINDS) {
    const lastIndex = lastIndexByKind.get(kind);
    if (lastIndex !== undefined && plan.steps[lastIndex].approvalRequired !== true) {
      throw new Error(`Protected ${kind} workstream must end with an approval-required step`);
    }
  }
  return plan;
}

export function parsePlanJson(source) {
  if (typeof source !== 'string' || source.length === 0 ||
      new TextEncoder().encode(source).byteLength > MAX_PLAN_BYTES) {
    throw new Error('Plan file is empty or exceeds 128 KiB');
  }
  let plan;
  try { plan = JSON.parse(source); }
  catch { throw new Error('Plan file is not valid JSON'); }
  return validatePlan(plan);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function digestPlan(plan) {
  validatePlan(plan);
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const bytes = new TextEncoder().encode(stableStringify(plan));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createApprovalPacket(plan, now = new Date()) {
  validatePlan(plan);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('A valid review timestamp is required');
  const decisions = plan.steps.filter(step => step.approvalRequired).map(step => ({
    stepId: step.id,
    decision: 'pending',
    decidedAt: null,
    reviewerNote: '',
  }));
  return {
    schemaVersion: 1,
    planDigest: await digestPlan(plan),
    createdAt: now.toISOString(),
    decisions,
  };
}

export async function validateApprovalPacket(packet, plan) {
  validatePlan(plan);
  if (!hasExactKeys(packet, PACKET_KEYS) || packet.schemaVersion !== 1 ||
      typeof packet.planDigest !== 'string' || !/^[a-f0-9]{64}$/.test(packet.planDigest) ||
      !isIsoDate(packet.createdAt) || !Array.isArray(packet.decisions) ||
      packet.decisions.length > MAX_STEPS) {
    throw new Error('Invalid approval packet envelope');
  }
  const expectedSteps = plan.steps.filter(step => step.approvalRequired).map(step => step.id);
  if (packet.decisions.length !== expectedSteps.length) throw new Error('Approval items do not match the plan');
  const seen = new Set();
  for (let i = 0; i < packet.decisions.length; i++) {
    const item = packet.decisions[i];
    if (!hasExactKeys(item, DECISION_KEYS) || item.stepId !== expectedSteps[i] || seen.has(item.stepId) ||
        !DECISIONS.has(item.decision) || typeof item.reviewerNote !== 'string' ||
        item.reviewerNote.length > MAX_NOTE_CHARS || hasControlChars(item.reviewerNote)) {
      throw new Error('Invalid approval decision item');
    }
    if (item.decision === 'pending') {
      if (item.decidedAt !== null || item.reviewerNote !== '') throw new Error('Pending decisions cannot include a timestamp or note');
    } else {
      if (!isIsoDate(item.decidedAt)) throw new Error('Reviewed decisions require an ISO timestamp');
      if (item.decision === 'rejected' && item.reviewerNote.trim().length < 5) {
        throw new Error('Rejected decisions require a reason of at least 5 characters');
      }
    }
    seen.add(item.stepId);
  }
  const expectedDigest = await digestPlan(plan);
  if (packet.planDigest !== expectedDigest) throw new Error('Approval packet is bound to a different plan');
  return packet;
}

export async function decideApproval(packet, plan, stepId, decision, reviewerNote = '', now = new Date()) {
  await validateApprovalPacket(packet, plan);
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Decision must be approved or rejected');
  if (typeof reviewerNote !== 'string' || reviewerNote.length > MAX_NOTE_CHARS || hasControlChars(reviewerNote)) {
    throw new Error('Reviewer note must be plain text up to 240 characters');
  }
  if (decision === 'rejected' && reviewerNote.trim().length < 5) {
    throw new Error('A rejection reason must contain at least 5 characters');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('A valid review timestamp is required');
  const index = packet.decisions.findIndex(item => item.stepId === stepId);
  if (index < 0) throw new Error('Unknown approval item');
  if (packet.decisions[index].decision !== 'pending') throw new Error('A recorded decision cannot be overwritten');
  const decisions = packet.decisions.map((item, i) => i === index ? {
    ...item,
    decision,
    decidedAt: now.toISOString(),
    reviewerNote: reviewerNote.trim(),
  } : { ...item });
  const updated = { ...packet, decisions };
  await validateApprovalPacket(updated, plan);
  return updated;
}

export function summarizeApprovals(packet) {
  if (!isRecord(packet) || !Array.isArray(packet.decisions)) throw new Error('Invalid approval packet');
  const summary = { pending: 0, approved: 0, rejected: 0, total: packet.decisions.length };
  for (const item of packet.decisions) {
    if (!DECISIONS.has(item?.decision)) throw new Error('Invalid approval decision');
    summary[item.decision]++;
  }
  summary.complete = summary.pending === 0;
  return summary;
}

function csvCell(value) {
  const raw = String(value ?? '');
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function exportApprovalJson(packet, plan) {
  await validateApprovalPacket(packet, plan);
  return `${JSON.stringify(packet, null, 2)}\n`;
}

export async function exportApprovalCsv(packet, plan) {
  await validateApprovalPacket(packet, plan);
  const rows = [['Step ID', 'Decision', 'Decided At', 'Reviewer Note']];
  for (const item of packet.decisions) rows.push([item.stepId, item.decision, item.decidedAt ?? '', item.reviewerNote]);
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
