import { describe, expect, it } from 'vitest'
import {
  MAX_TASK_PLAN_IMPORT_BYTES,
  parseTaskPlanJson,
} from './omda-plan-import'

function makePlan() {
  return {
    planId: 'omda-plan-abc123',
    createdAt: '2026-11-12T05:00:00.000Z',
    mode: 'plan_only' as const,
    requestSummary: 'Create a tracker',
    categories: ['spreadsheet'],
    steps: [{
      id: 'spreadsheet-1',
      title: 'Validate workbook',
      detail: 'Check columns and rows',
      status: 'ready' as const,
      externalSideEffect: false,
    }],
    guardrails: {
      providerCalls: false,
      externalWrites: false,
      publicPublishing: false,
      approvalRequiredFor: ['send_email', 'submit_job_application', 'publish_website', 'publish_video'],
    },
  }
}

const serialize = (value: unknown) => JSON.stringify(value)

describe('OMDA task plan import', () => {
  it('restores a valid exported plan without changing its data', () => {
    const plan = makePlan()
    expect(parseTaskPlanJson(serialize(plan))).toEqual(plan)
  })

  it('rejects malformed JSON with a clear error', () => {
    expect(() => parseTaskPlanJson('{broken')).toThrow(/valid JSON/)
  })

  it('rejects files above the bounded import size before parsing', () => {
    expect(() => parseTaskPlanJson(' '.repeat(MAX_TASK_PLAN_IMPORT_BYTES + 1))).toThrow(/128 KiB/)
  })

  it('rejects unknown top-level properties instead of silently accepting them', () => {
    const plan = { ...makePlan(), ownerToken: 'must-not-be-imported' }
    expect(() => parseTaskPlanJson(serialize(plan))).toThrow(/top-level structure/)
  })

  it('rejects unsupported categories', () => {
    const plan = { ...makePlan(), categories: ['billing_admin'] }
    expect(() => parseTaskPlanJson(serialize(plan))).toThrow(/unknown task category/)
  })

  it('rejects duplicate step identifiers', () => {
    const step = makePlan().steps[0]
    const plan = { ...makePlan(), steps: [step, { ...step }] }
    expect(() => parseTaskPlanJson(serialize(plan))).toThrow(/duplicate step identifier/)
  })

  it('rejects a step whose category is not declared by the plan', () => {
    const plan = { ...makePlan(), steps: [{ ...makePlan().steps[0], id: 'website-1' }] }
    expect(() => parseTaskPlanJson(serialize(plan))).toThrow(/does not belong/)
  })

  it('keeps every external side effect behind an approval gate', () => {
    const plan = {
      ...makePlan(),
      steps: [{ ...makePlan().steps[0], status: 'ready', externalSideEffect: true }],
    }
    expect(() => parseTaskPlanJson(serialize(plan))).toThrow(/approval-gated/)
  })

  it('rejects guardrails that enable provider calls or external writes', () => {
    const plan = { ...makePlan(), guardrails: { ...makePlan().guardrails, providerCalls: true } }
    expect(() => parseTaskPlanJson(serialize(plan))).toThrow(/cannot enable/)
  })

  it('rejects an export that removes one of the required approval categories', () => {
    const plan = {
      ...makePlan(),
      guardrails: {
        ...makePlan().guardrails,
        approvalRequiredFor: ['send_email', 'publish_website', 'publish_video'],
      },
    }
    expect(() => parseTaskPlanJson(serialize(plan))).toThrow(/approval gates/)
  })

  it('rejects invalid dates and oversized step collections', () => {
    const invalidDate = { ...makePlan(), createdAt: 'yesterday' }
    expect(() => parseTaskPlanJson(serialize(invalidDate))).toThrow(/timestamp/)
    const tooManySteps = {
      ...makePlan(),
      steps: Array.from({ length: 33 }, (_, index) => ({
        ...makePlan().steps[0],
        id: 'spreadsheet-' + (index + 1),
      })),
    }
    expect(() => parseTaskPlanJson(serialize(tooManySteps))).toThrow(/step count/)
  })
})
