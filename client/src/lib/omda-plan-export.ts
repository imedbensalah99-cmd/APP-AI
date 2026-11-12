export interface OmdaTaskPlanExport {
  planId: string
  createdAt: string
  mode: 'plan_only'
  requestSummary: string
  categories: string[]
  steps: Array<{
    id: string
    title: string
    detail: string
    status: 'ready' | 'approval_required'
    externalSideEffect: boolean
  }>
  guardrails: {
    providerCalls: boolean
    externalWrites: boolean
    publicPublishing: boolean
    approvalRequiredFor: string[]
  }
}

export type TaskPlanExportFormat = 'json' | 'csv'

export function serializeTaskPlanJson(plan: OmdaTaskPlanExport): string {
  return JSON.stringify(plan, null, 2) + '\n'
}

function csvCell(value: string | boolean): string {
  const text = String(value).replace(/\r\n?/g, '\n')
  // Prefix spreadsheet formula starters, including ones hidden behind
  // whitespace/control characters. Quoting alone does not stop formula execution.
  const safe = /^[\u0000-\u0020]*[=+\-@]/.test(text) ? "'" + text : text
  return '"' + safe.replace(/"/g, '""') + '"'
}

export function serializeTaskPlanCsv(plan: OmdaTaskPlanExport): string {
  const header = [
    'record_type',
    'plan_id',
    'created_at',
    'mode',
    'categories',
    'request_summary',
    'step_id',
    'title',
    'detail',
    'status',
    'external_side_effect',
  ]
  const metadata = [
    'plan',
    plan.planId,
    plan.createdAt,
    plan.mode,
    plan.categories.join(' | '),
    plan.requestSummary,
    '',
    '',
    '',
    '',
    '',
  ]
  const rows = [
    header,
    metadata,
    ...plan.steps.map(step => [
      'step',
      plan.planId,
      plan.createdAt,
      plan.mode,
      '',
      '',
      step.id,
      step.title,
      step.detail,
      step.status,
      step.externalSideEffect,
    ]),
  ]
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function taskPlanFilename(plan: Pick<OmdaTaskPlanExport, 'planId'>, format: TaskPlanExportFormat): string {
  const safeId = plan.planId.normalize('NFKC').replace(/[^a-z0-9_-]/gi, '').slice(0, 64)
  return 'omda-' + (safeId || 'task-plan') + '.' + format
}

export function downloadTaskPlan(plan: OmdaTaskPlanExport, format: TaskPlanExportFormat): void {
  const isJson = format === 'json'
  const content = isJson ? serializeTaskPlanJson(plan) : serializeTaskPlanCsv(plan)
  const mime = isJson ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8'
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = taskPlanFilename(plan, format)
  anchor.hidden = true
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
