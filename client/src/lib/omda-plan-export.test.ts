import { describe, expect, it } from 'vitest'
import {
  serializeTaskPlanCsv,
  serializeTaskPlanJson,
  taskPlanFilename,
  type OmdaTaskPlanExport,
} from './omda-plan-export'

function makePlan(overrides: Partial<OmdaTaskPlanExport> = {}): OmdaTaskPlanExport {
  return {
    planId: 'omda-plan-abc123',
    createdAt: '2026-11-12T05:00:00.000Z',
    mode: 'plan_only',
    requestSummary: 'Create a tracker',
    categories: ['spreadsheet'],
    steps: [{
      id: 'spreadsheet-1',
      title: 'Validate workbook',
      detail: 'Check columns and rows',
      status: 'ready',
      externalSideEffect: false,
    }],
    guardrails: {
      providerCalls: false,
      externalWrites: false,
      publicPublishing: false,
      approvalRequiredFor: ['send_email'],
    },
    ...overrides,
  }
}

describe('OMDA task plan exports', () => {
  it('serializes a complete JSON plan without losing guardrails', () => {
    const plan = makePlan()
    const output = serializeTaskPlanJson(plan)
    expect(output.endsWith('\n')).toBe(true)
    expect(JSON.parse(output)).toEqual(plan)
  })

  it('creates an Excel-friendly UTF-8 CSV with a metadata row and ordered steps', () => {
    const output = serializeTaskPlanCsv(makePlan())
    expect(output.charCodeAt(0)).toBe(0xFEFF)
    expect(output).toContain('"record_type","plan_id"')
    expect(output).toContain('"plan","omda-plan-abc123"')
    expect(output).toContain('"step","omda-plan-abc123"')
    expect(output).toContain('"spreadsheet-1","Validate workbook"')
  })

  it('neutralizes formula starters in exported user-controlled cells', () => {
    const plan = makePlan({
      steps: [{
        id: 'step-1',
        title: '=HYPERLINK("https://example.invalid","open")',
        detail: '  +1+1',
        status: 'ready',
        externalSideEffect: false,
      }],
    })
    const output = serializeTaskPlanCsv(plan)
    expect(output).toContain("'=HYPERLINK(")
    expect(output).toContain("'  +1+1")
  })

  it('preserves CSV quotes, commas and embedded newlines safely', () => {
    const plan = makePlan({
      steps: [{
        id: 'step-2',
        title: 'Review, "then" export',
        detail: 'First line\nSecond line',
        status: 'approval_required',
        externalSideEffect: true,
      }],
    })
    const output = serializeTaskPlanCsv(plan)
    expect(output).toContain('"Review, ""then"" export"')
    expect(output).toContain('"First line\nSecond line"')
    expect(output).toContain('"approval_required","true"')
  })

  it('sanitizes the downloaded filename and limits its length', () => {
    expect(taskPlanFilename({ planId: '../../unsafe id' }, 'json')).toBe('omda-unsafeid.json')
    expect(taskPlanFilename({ planId: '***' }, 'csv')).toBe('omda-task-plan.csv')
    expect(taskPlanFilename({ planId: 'x'.repeat(100) }, 'json')).toBe('omda-' + 'x'.repeat(64) + '.json')
  })
})
