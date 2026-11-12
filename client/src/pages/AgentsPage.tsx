import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, FileJson, FileSpreadsheet, Globe } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useI18n } from '@/i18n'
import { PageHeader } from '@/components/page-header'
import { CopyButton } from '@/components/copy-button'
import { AgentIcon } from '@/components/agent-icons'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { downloadTaskPlan, type OmdaTaskPlanExport } from '@/lib/omda-plan-export'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import toolCatalog from '@/data/agent-tools.json'

interface ClientAnalytics {
  clientAgent: string
  requests: number
  lastSeenAt: string | null
}

interface KeyResponse {
  apiKey: string
}

type TaskPlanResponse = OmdaTaskPlanExport

const analyticsIds: Record<string, string> = {
  claude: 'claude-code',
  codex: 'codex',
  cline: 'cline',
  continue: 'continue',
  aider: 'aider',
  opencode: 'opencode',
  goose: 'goose',
  qwen: 'qwen-code',
  roo: 'roo',
  kilo: 'kilo-code',
  crush: 'crush',
  dsh: 'deepseek-harness',
  mimo: 'mimo-code',
  atomcode: 'atomcode',
  openclaw: 'openclaw',
  hermes: 'hermes-agent',
  pi: 'pi',
  reasonix: 'reasonix',
  zcode: 'zcode',
  cursor: 'cursor',
}

// Agents whose built-in web search tool the gateway serves from the search
// keys (#1174): Claude Code's WebSearch and Codex's web_search.
const WEB_SEARCH_TOOL_KEYS: Record<string, string> = {
  claude: 'search.agentsBadgeClaude',
  codex: 'search.agentsBadgeCodex',
}

function masked(value: string): string {
  if (value.length < 12) return '••••••••'
  return \`\${value.slice(0, 8)}\${'•'.repeat(12)}\${value.slice(-4)}\`
}

export default function AgentsPage() {
  const { t } = useI18n()
  const [revealKey, setRevealKey] = useState(false)
  const [taskRequest, setTaskRequest] = useState('')
  const [taskPlan, setTaskPlan] = useState<TaskPlanResponse | null>(null)
  const [planningTask, setPlanningTask] = useState(false)
  const [taskPlanError, setTaskPlanError] = useState('')
  const isArabic = typeof document !== 'undefined' && (
    document.documentElement.lang.toLowerCase().startsWith('ar') || document.documentElement.dir === 'rtl'
  )

  async function createTaskPlan() {
    setPlanningTask(true)
    setTaskPlanError('')
    setTaskPlan(null)
    try {
      const result = await apiFetch<TaskPlanResponse>('/api/omda/tasks/plan', {
        method: 'POST',
        body: JSON.stringify({ request: taskRequest, locale: isArabic ? 'ar' : 'en' }),
      })
      setTaskPlan(result)
    } catch (error) {
      setTaskPlanError(error instanceof Error ? error.message : 'Unable to create a task plan')
    } finally {
      setPlanningTask(false)
    }
  }
  const { data: keyData } = useQuery<KeyResponse>({
    queryKey: ['api-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })
  const { data: byClient = [] } = useQuery<ClientAnalytics[]>({
    queryKey: ['analytics', 'by-client', '30d'],
    queryFn: () => apiFetch('/api/analytics/by-client?range=30d'),
  })
  // "Seen recently" means traffic within the last 7 days, not merely any row
  // in the fetched 30-day window.
  const seenCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const seen = new Map(byClient
    .filter(row => row.lastSeenAt && Date.parse(row.lastSeenAt) >= seenCutoff)
    .map(row => [row.clientAgent, row]))
  const origin = import.meta.env.DEV
    ? \`http://\${window.location.hostname}:\${__SERVER_PORT__}\`
    : window.location.origin
  const shownKey = keyData?.apiKey
    ? (revealKey ? keyData.apiKey : masked(keyData.apiKey))
    : '…'

  return (
    <div>
      <PageHeader
        title={t('agents.title')}
        description={t('agents.description')}
        actions={
          <Button variant="outline" size="sm" onClick={() => setRevealKey(value => !value)}>
            {revealKey ? t('common.hide') : t('common.show')} {t('agents.apiKey')}
          </Button>
        }
      />

      <section className="mb-6 rounded-3xl border bg-card p-5">
        <h2 className="text-sm font-medium">{t('agents.quickstartTitle')}</h2>
        <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">{t('agents.quickstart')}</p>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">
            npx freellmapi setup-claude --url {origin}
          </code>
          <CopyButton
            text={\`npx freellmapi setup-claude --url \${origin}\`}
            className="size-7 shrink-0"
            label={t('common.copy')}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{t('agents.currentKey')}</span>
          <code className="font-mono break-all">{shownKey}</code>
        </div>
      </section>

      <section className="mb-6 rounded-3xl border bg-card p-5">
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-medium">
              {isArabic ? 'مخطط مهام OMDA' : 'OMDA task planner'}
            </h2>
            <p className="mt-1 max-w-prose text-xs text-muted-foreground">
              {isArabic
                ? 'اكتب طلبك بالعربية أو الإنجليزية لتحويله إلى خطوات مرتبة مع بوابات موافقة. هذه معاينة خطة فقط ولا تنفذ إجراءات خارجية.'
                : 'Describe a task in Arabic or English to create an ordered plan with approval gates. This is a plan preview; it does not perform external actions.'}
            </p>
          </div>
          <textarea
            value={taskRequest}
            onChange={event => setTaskRequest(event.target.value)}
            rows={3}
            maxLength={4000}
            aria-label={isArabic ? 'وصف المهمة' : 'Task request'}
            placeholder={isArabic ? 'مثال: أنشئ جدول وظائف Excel وجهّز مسودة بريد...' : 'Example: Build a job tracker spreadsheet and draft an email...'}
            className="w-full resize-y rounded-xl border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{taskRequest.length}/4000</span>
            <Button size="sm" disabled={planningTask || taskRequest.trim().length < 5} onClick={() => void createTaskPlan()}>
              {planningTask
                ? (isArabic ? 'جارٍ إعداد الخطة…' : 'Planning…')
                : (isArabic ? 'إنشاء خطة آمنة' : 'Create safe plan')}
            </Button>
          </div>
          {taskPlanError && <p role="alert" className="text-xs text-destructive">{taskPlanError}</p>}
          {taskPlan && (
            <div className="rounded-2xl border bg-muted/20 p-4" aria-live="polite">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{taskPlan.categories.join(' · ')}</Badge>
                <Badge variant="secondary">{isArabic ? 'معاينة فقط' : 'Plan only'}</Badge>
              </div>
              <ol className="space-y-3">
                {taskPlan.steps.map((step, index) => (
                  <li key={step.id} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-medium">{step.title}</p>
                        {step.status === 'approval_required' && (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                            {isArabic ? 'يتطلب موافقة' : 'Approval required'}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-4 border-t pt-3 text-[11px] text-muted-foreground">
                {isArabic
                  ? 'الحماية مفعّلة: لا استدعاءات مزودين، لا كتابة خارجية، ولا نشر عام.'
                  : 'Guardrails active: no provider calls, no external writes and no public publishing.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadTaskPlan(taskPlan, 'json')}>
                  <FileJson className="size-4" />
                  {isArabic ? 'تنزيل JSON' : 'Download JSON'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadTaskPlan(taskPlan, 'csv')}>
                  <FileSpreadsheet className="size-4" />
                  {isArabic ? 'تنزيل CSV' : 'Download CSV'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {toolCatalog.map(tool => {
          const traffic = seen.get(analyticsIds[tool.id] ?? tool.id)
          const command = \`npx freellmapi \${tool.command} --url \${origin}\`
          const endpoint = tool.baseUrlSupport === 'root' ? origin : \`\${origin}/v1\`
          // The copied snippet is pasted into config files — keep it
          // locale-independent.
          const realConnection = \`BASE_URL=\${endpoint}\nAPI_KEY=\${keyData?.apiKey ?? '<unified-key>'}\`
          const shownConnection = \`BASE_URL=\${endpoint}\nAPI_KEY=\${shownKey}\`
          // What the tool actually is, in one plain sentence. \`t\` echoes the
          // key back when neither the active locale nor English defines it, so
          // a catalog entry added ahead of its copy falls back to the wire
          // details rather than printing a dotted key at the reader.
          const descriptionKey = \`agents.descriptions.\${tool.id}\`
          const description = t(descriptionKey)
          return (
            <Card key={tool.id} size="sm">
              <CardHeader>
                <AgentIcon id={tool.id} name={tool.name} className="mb-1.5" />
                <CardTitle>{tool.name}</CardTitle>
                <CardDescription className="text-xs">
                  {description === descriptionKey
                    ? \`\${tool.protocol} · \${tool.baseUrlSupport}\`
                    : description}
                </CardDescription>
                <CardAction>
                  {traffic && (
                    <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 />
                      {t('agents.seenRecently')}
                    </Badge>
                  )}
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                {WEB_SEARCH_TOOL_KEYS[tool.id] && (
                  <Badge
                    variant="outline"
                    className="h-auto w-fit whitespace-normal border-sky-600/30 py-0.5 text-[11px] text-sky-700 dark:text-sky-300"
                  >
                    <Globe />
                    {t(WEB_SEARCH_TOOL_KEYS[tool.id])}
                  </Badge>
                )}
                <div>
                  <p className="text-xs font-medium">{t('agents.setupLabel')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {tool.configType === 'guide' ? t('agents.setupGuideHint') : t('agents.setupHint')}
                  </p>
                  <div className="mt-2 flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{command}</code>
                    <CopyButton text={command} className="size-7 shrink-0" label={t('common.copy')} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium">{t('agents.manualLabel')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('agents.manualHint')}</p>
                  <div className="mt-2 flex items-start gap-2 rounded-xl border px-3 py-2">
                    <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[11px]">
                      {shownConnection}
                    </code>
                    <CopyButton
                      text={realConnection}
                      className="size-7 shrink-0"
                      label={t('common.copy')}
                    />
                  </div>
                </div>
                <a
                  href={tool.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-auto inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {t('agents.documentation')} <ExternalLink className="size-3" />
                </a>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
