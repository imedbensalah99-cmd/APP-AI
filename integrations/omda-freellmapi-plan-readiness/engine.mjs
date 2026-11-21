// OMDA Plan Readiness Analyzer — offline, deterministic and bounded.
import { validatePlan } from '../omda-freellmapi-workflow-studio/engine.mjs';

const MAX_PLAN_BYTES = 131072;
const PLAN_KEYS = ['schemaVersion', 'command', 'mode', 'networkCalls', 'paidCalls', 'generatedAt', 'steps'];
const STEP_KEYS = ['id', 'kind', 'title', 'status', 'dependsOn', 'approvalRequired', 'approved', 'execution', 'note'];
const KINDS = new Set(['website', 'spreadsheet', 'document', 'email', 'jobs', 'code', 'general']);
const PROTECTED_KINDS = new Set(['website', 'email', 'jobs', 'code']);
const SEVERITY_ORDER = { blocker: 0, high: 1, medium: 2, low: 3, info: 4 };
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const SIDE_EFFECT = /\b(send|submit|publish|deploy|release|merge|apply|upload|delete|remove|purchase|charge|invite|share publicly)\b|إرسال|ارسال|تقديم|نشر|رفع|حذف|شراء|دمج|إطلاق|اعتماد خارجي/i;
const GENERIC_TITLE = /^(task|work|step|review|check|complete|implement|do it|مهمة|عمل|خطوة|مراجعة|فحص|تنفيذ)$/i;

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid ' + label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) {
    throw new TypeError('Unexpected or missing fields in ' + label);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const api = globalThis.crypto;
  if (!api || !api.subtle) throw new Error('Web Crypto SHA-256 is unavailable in this context');
  const bytes = new TextEncoder().encode(value);
  const digest = await api.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function validAnalysisTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid analysis clock');
  return date.toISOString();
}

function add(findings, code, severity, stepId, message, recommendation) {
  findings.push({ code, severity, stepId: stepId || null, message, recommendation });
}

function csvCell(value) {
  const raw = String(value ?? '');
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function summarize(findings) {
  const counts = { blocker: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const item of findings) counts[item.severity] += 1;
  return counts;
}

async function analyzePlan(plan, options = {}) {
  validatePlan(plan);
  exactKeys(plan, PLAN_KEYS, 'plan');
  if (typeof plan.command !== 'string' || CONTROL.test(plan.command)) throw new TypeError('Invalid plan command');
  if (plan.steps.length > 24) throw new TypeError('Plan exceeds the 24-step limit');
  if (plan.generatedAt !== null && (typeof plan.generatedAt !== 'string' || !Number.isFinite(Date.parse(plan.generatedAt)))) {
    throw new TypeError('Invalid generatedAt timestamp');
  }

  const findings = [];
  const kinds = new Set();
  const gatedKinds = new Set();
  const externalIds = new Set();
  const lastByKind = new Map();

  if (plan.networkCalls !== 0) {
    add(findings, 'network-calls-enabled', 'blocker', null, 'الخطة تسمح باتصالات شبكة غير صفرية.', 'أعد تصدير خطة PLAN_ONLY واجعل networkCalls مساويًا للصفر.');
  }
  if (plan.paidCalls !== 0) {
    add(findings, 'paid-calls-enabled', 'blocker', null, 'الخطة تحتوي على استدعاءات مدفوعة.', 'أزل أي اعتماد مدفوع قبل اعتماد الخطة.');
  }
  if (plan.generatedAt === null) {
    add(findings, 'plan-undated', 'info', null, 'الخطة لا تحتوي على وقت إنشاء.', 'أعد تصدير الخطة بعد مراجعتها إذا كان تتبع العمر مهمًا.');
  } else if (new Date(plan.generatedAt).toISOString() !== plan.generatedAt) {
    add(findings, 'plan-time-not-canonical', 'medium', null, 'توقيت الخطة ليس بصيغة ISO UTC القياسية.', 'استخدم توقيت ISO UTC عند تصدير الخطة.');
  }

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index];
    exactKeys(step, STEP_KEYS, 'step');
    if (!KINDS.has(step.kind)) throw new TypeError('Unsupported workstream kind: ' + String(step.kind));
    if (typeof step.note !== 'string' || step.note.length > 240 || CONTROL.test(step.note)) {
      throw new TypeError('Invalid step note');
    }
    if (typeof step.title !== 'string' || CONTROL.test(step.title)) throw new TypeError('Invalid step title');

    kinds.add(step.kind);
    if (step.approvalRequired) gatedKinds.add(step.kind);
    if (SIDE_EFFECT.test(step.title)) {
      externalIds.add(step.id);
      if (!step.approvalRequired) {
        add(findings, 'external-action-without-gate', 'blocker', step.id,
          'تبدو هذه المرحلة وكأنها تنفذ أثرًا خارجيًا دون بوابة موافقة.',
          'افصل التحضير عن الإجراء الخارجي وأضف بوابة موافقة صريحة قبل التنفيذ.');
      }
    }

    if (PROTECTED_KINDS.has(step.kind) && !step.approvalRequired && !gatedKinds.has(step.kind)) {
      // A workstream-level gate is checked again after the full scan.
    }

    const previous = lastByKind.get(step.kind);
    if (previous && !step.dependsOn.includes(previous.id)) {
      add(findings, 'workstream-dependency-gap', 'high', step.id,
        'توجد مرحلة سابقة في مسار العمل نفسه لكنها ليست ضمن المتطلبات السابقة.',
        'اربط المرحلة بالمرحلة السابقة في المسار نفسه قبل بدء العمل.');
    }
    lastByKind.set(step.kind, step);

    if (step.approved) {
      add(findings, 'imported-approval-untrusted', 'medium', step.id,
        'حقل approved داخل ملف الخطة ليس إثبات موافقة مستقلًا.',
        'لا تعتمد هذا العلم وحده؛ احتفظ بإيصال مراجعة منفصل مرتبط ببصمة الخطة.');
    }
    if (GENERIC_TITLE.test(step.title.trim())) {
      add(findings, 'generic-step-title', 'medium', step.id,
        'عنوان المرحلة عام ولا يحدد نتيجة قابلة للتحقق.',
        'استبدل العنوان بمخرج واضح يمكن مراجعته.');
    } else if (step.title.trim().length < 12) {
      add(findings, 'short-step-title', 'low', step.id,
        'عنوان المرحلة قصير وقد لا يوضح نطاق العمل.',
        'أضف وصفًا موجزًا للنتيجة المتوقعة.');
    }
    if (step.status === 'done' && step.note.trim().length < 12) {
      add(findings, 'completed-without-evidence-note', 'low', step.id,
        'المرحلة معلّمة كمكتملة دون ملاحظة دليل كافية.',
        'أضف مرجعًا أو وصف تحقق غير حساس إلى الملاحظة.');
    }
    if (step.approvalRequired) {
      const laterSameKind = plan.steps.slice(index + 1).some(item => item.kind === step.kind);
      if (laterSameKind) {
        add(findings, 'approval-gate-not-terminal', 'high', step.id,
          'بوابة الموافقة ليست آخر مرحلة في مسار العمل نفسه.',
          'انقل بوابة الموافقة إلى ما بعد جميع خطوات التحضير.');
      }
    }
  }

  for (const kind of PROTECTED_KINDS) {
    if (kinds.has(kind) && !gatedKinds.has(kind)) {
      add(findings, 'protected-workstream-missing-gate', 'blocker', null,
        'مسار ' + kind + ' لا يحتوي على بوابة موافقة.',
        'أضف مرحلة مراجعة وموافقة قبل أي إرسال أو تقديم أو نشر أو إصدار.');
    }
  }

  if (plan.steps.length > 18) {
    add(findings, 'large-plan', 'medium', null, 'الخطة كبيرة نسبيًا وقد يصعب مراجعتها دفعة واحدة.',
      'قسّم الخطة إلى خطط أصغر مع الحفاظ على التبعيات وبوابات الموافقة.');
  }
  if (externalIds.size > 0 && gatedKinds.size === 0) {
    add(findings, 'no-gates-for-external-actions', 'blocker', null,
      'تم رصد آثار خارجية محتملة دون أي بوابة مراجعة.',
      'أضف مراجعة بشرية قبل كل إجراء خارجي.');
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    String(a.stepId || '').localeCompare(String(b.stepId || '')) || a.code.localeCompare(b.code));

  const counts = summarize(findings);
  const penalty = counts.blocker * 45 + counts.high * 20 + counts.medium * 10 + counts.low * 4;
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const decision = counts.blocker > 0 ? 'BLOCKED' :
    (counts.high > 0 || counts.medium > 0) ? 'REVIEW' : 'READY';
  const analyzedAt = validAnalysisTime(options.now ?? new Date());
  const planDigest = await sha256(canonical(plan));

  return {
    schemaVersion: 1,
    analyzedAt,
    planDigest,
    decision,
    score,
    summary: {
      totalSteps: plan.steps.length,
      protectedWorkstreams: [...kinds].filter(kind => PROTECTED_KINDS.has(kind)).length,
      gatedWorkstreams: gatedKinds.size,
      externalActionSteps: externalIds.size,
      findings: findings.length,
      bySeverity: counts
    },
    findings,
    limits: { maxPlanBytes: MAX_PLAN_BYTES, maxSteps: 24, networkCalls: 0, paidCalls: 0 }
  };
}

async function analyzePlanJson(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('Plan JSON must be text');
  if (new TextEncoder().encode(source).byteLength > MAX_PLAN_BYTES) throw new RangeError('Plan JSON exceeds 128 KiB');
  let plan;
  try { plan = JSON.parse(source); }
  catch { throw new SyntaxError('Plan JSON is malformed'); }
  return analyzePlan(plan, options);
}

function exportReportJSON(report) {
  if (!report || report.schemaVersion !== 1 || !Array.isArray(report.findings)) throw new TypeError('Invalid readiness report');
  return JSON.stringify(report, null, 2) + '\n';
}

function exportReportCSV(report) {
  if (!report || report.schemaVersion !== 1 || !Array.isArray(report.findings)) throw new TypeError('Invalid readiness report');
  const rows = [['Code', 'Severity', 'Step ID', 'Finding', 'Recommendation']];
  for (const item of report.findings) rows.push([item.code, item.severity, item.stepId || '', item.message, item.recommendation]);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export {
  analyzePlan, analyzePlanJson, exportReportJSON, exportReportCSV, csvCell,
  MAX_PLAN_BYTES, PLAN_KEYS, STEP_KEYS
};
