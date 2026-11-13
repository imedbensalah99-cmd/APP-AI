import type { OmdaTaskPlanExport } from './omda-plan-export'

export const MAX_TASK_PLAN_IMPORT_BYTES = 128 * 1024

const CATEGORIES = ['website', 'spreadsheet', 'job_search', 'email_draft', 'research', 'general'] as const
const REQUIRED_APPROVALS = ['send_email', 'submit_job_application', 'publish_website', 'publish_video'] as const

const ROOT_KEYS = ['planId', 'createdAt', 'mode', 'requestSummary', 'categories', 'steps', 'guardrails']
const STEP_KEYS = ['id', 'title', 'detail', 'status', 'externalSideEffect']
const GUARDRAIL_KEYS = ['providerCalls', 'externalWrites', 'publicPublishing', 'approvalRequiredFor']

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: JsonRecord, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function boundedText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string'
    && value.length >= min
    && value.length <= max
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
}

function fail(message: string): never {
  throw new TypeError('Invalid OMDA task plan: ' + message)
}

/**
 * Parse an exported plan as untrusted input. This validates the complete shape
 * and safety invariants before the object is passed to React or re-exported.
 */
export function parseTaskPlanJson(raw: string): OmdaTaskPlanExport {
  if (typeof raw !== 'string') throw new TypeError('Task plan file must be text')
  if (new TextEncoder().encode(raw).byteLength > MAX_TASK_PLAN_IMPORT_BYTES) {
    throw new RangeError('Task plan file exceeds the 128 KiB import limit')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new TypeError('Task plan file is not valid JSON')
  }

  if (!isRecord(parsed) || !hasExactKeys(parsed, ROOT_KEYS)) fail('unexpected top-level structure')
  if (!boundedText(parsed.planId, 12, 96) || !/^omda-plan-[a-z0-9-]+$/i.test(parsed.planId)) {
    fail('invalid plan identifier')
  }
  if (!boundedText(parsed.createdAt, 20, 32)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(parsed.createdAt)
    || !Number.isFinite(Date.parse(parsed.createdAt))) {
    fail('invalid creation timestamp')
  }
  if (parsed.mode !== 'plan_only') fail('only plan_only exports can be imported')
  if (!boundedText(parsed.requestSummary, 5, 220)) fail('invalid request summary')

  if (!Array.isArray(parsed.categories) || parsed.categories.length < 1 || parsed.categories.length > CATEGORIES.length) {
    fail('invalid categories')
  }
  const categories = parsed.categories
  if (!categories.every(category => typeof category === 'string' && CATEGORIES.includes(category as typeof CATEGORIES[number]))) {
    fail('unknown task category')
  }
  if (new Set(categories).size !== categories.length) fail('duplicate task category')

  if (!Array.isArray(parsed.steps) || parsed.steps.length < 1 || parsed.steps.length > 32) {
    fail('step count must be between 1 and 32')
  }
  const seenIds = new Set<string>()
  for (const step of parsed.steps) {
    if (!isRecord(step) || !hasExactKeys(step, STEP_KEYS)) fail('invalid step structure')
    if (!boundedText(step.id, 3, 64) || !boundedText(step.title, 1, 180) || !boundedText(step.detail, 1, 800)) {
      fail('invalid step text')
    }
    if (!categories.some(category => step.id.startsWith(category + '-'))
      || !new RegExp('^(' + categories.join('|') + ')-[1-9][0-9]?$').test(step.id)) {
      fail('step does not belong to a declared category')
    }
    if (seenIds.has(step.id)) fail('duplicate step identifier')
    seenIds.add(step.id)
    if (step.status !== 'ready' && step.status !== 'approval_required') fail('invalid step status')
    if (typeof step.externalSideEffect !== 'boolean') fail('invalid side-effect flag')
    if ((step.status === 'approval_required') !== step.externalSideEffect) {
      fail('external side effects must remain approval-gated')
    }
  }

  if (!isRecord(parsed.guardrails) || !hasExactKeys(parsed.guardrails, GUARDRAIL_KEYS)) {
    fail('invalid guardrail structure')
  }
  if (parsed.guardrails.providerCalls !== false
    || parsed.guardrails.externalWrites !== false
    || parsed.guardrails.publicPublishing !== false) {
    fail('imported plans cannot enable provider calls, external writes or public publishing')
  }
  const approvals = parsed.guardrails.approvalRequiredFor
  if (!Array.isArray(approvals)
    || approvals.length !== REQUIRED_APPROVALS.length
    || !approvals.every(value => typeof value === 'string' && REQUIRED_APPROVALS.includes(value as typeof REQUIRED_APPROVALS[number]))
    || new Set(approvals).size !== REQUIRED_APPROVALS.length) {
    fail('required approval gates are missing or invalid')
  }

  return parsed as unknown as OmdaTaskPlanExport
}
