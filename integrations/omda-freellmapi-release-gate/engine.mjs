// OMDA Release Gate — deterministic evaluator for user-imported cloud snapshots.
// No network, credentials, persistence, deployments, or provider calls.
export const EXPECTED_REPOSITORY = 'imedbensalah99-cmd/APP-AI';
export const EXPECTED_BRANCH = 'omda-freellmapi-secure-runtime-v1';
export const EXPECTED_RENDER_SERVICE = 'omda-freellmapi-secure-staging-v1';
export const REQUIRED_WORKERS = Object.freeze([
  'omda-freellmapi-agent-bridge-staging-v1',
  'omda-freellmapi-agent-private-console-staging-v1',
  'omda-freellmapi-agent-watch-staging-v1',
  'omda-freellmapi-secure-gateway-v1'
]);
export const MAX_INPUT_BYTES = 64 * 1024;
export const MAX_RUNS = 25;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const RUN_STATUSES = new Set(['queued', 'in_progress', 'completed']);
const CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale']);
const DEPLOY_STATUSES = new Set(['live', 'update_failed', 'build_failed', 'deactivated', 'created', 'building', 'unknown']);
const SEVERITY_ORDER = Object.freeze({ BLOCKER: 0, WARN: 1, INFO: 2, PASS: 3 });

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(label + ' must be an object');
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) {
    throw new TypeError(label + ' has missing or unsupported fields');
  }
}

function boundedString(value, label, max = 160, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.trim().length === 0) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new TypeError(label + ' is invalid');
  }
  return value;
}

function isoDate(value, label) {
  boundedString(value, label, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(label + ' must be an ISO timestamp');
  }
  return Date.parse(value);
}

function stringList(value, label, maxItems, maxLength = 120) {
  if (!Array.isArray(value) || value.length > maxItems) throw new TypeError(label + ' must be a bounded array');
  const seen = new Set();
  for (const item of value) {
    boundedString(item, label, maxLength);
    if (seen.has(item)) throw new TypeError(label + ' contains duplicates');
    seen.add(item);
  }
  return value;
}

function validCidr(value) {
  if (value === '0.0.0.0/0' || value === '::/0') return true;
  if (/^(?:\d{1,3}\.){3}\d{1,3}\/(?:[0-9]|[12]\d|3[0-2])$/.test(value)) {
    const [ip] = value.split('/');
    return ip.split('.').every(part => Number(part) <= 255);
  }
  return /^[0-9a-fA-F:]+\/(?:[0-9]|[1-9]\d|1[01]\d|12[0-8])$/.test(value);
}

export function validateSnapshot(snapshot, { now = Date.now() } = {}) {
  exactKeys(snapshot, ['schemaVersion', 'capturedAt', 'github', 'render', 'cloudflare'], 'snapshot');
  if (snapshot.schemaVersion !== 1) throw new TypeError('Unsupported snapshot schema');
  const capturedAt = isoDate(snapshot.capturedAt, 'capturedAt');
  if (capturedAt > now + 5 * 60 * 1000) throw new TypeError('capturedAt is in the future');

  exactKeys(snapshot.github, ['repository', 'branch', 'headSha', 'branchProtected', 'requiredChecks', 'runs'], 'github');
  boundedString(snapshot.github.repository, 'github.repository', 180);
  boundedString(snapshot.github.branch, 'github.branch', 120);
  if (!/^[a-f0-9]{40}$/i.test(snapshot.github.headSha)) throw new TypeError('github.headSha is invalid');
  if (typeof snapshot.github.branchProtected !== 'boolean') throw new TypeError('github.branchProtected is invalid');
  stringList(snapshot.github.requiredChecks, 'github.requiredChecks', 30, 120);
  if (!Array.isArray(snapshot.github.runs) || snapshot.github.runs.length > MAX_RUNS) throw new TypeError('github.runs exceeds the limit');
  for (const run of snapshot.github.runs) {
    exactKeys(run, ['id', 'branch', 'headSha', 'status', 'conclusion', 'updatedAt'], 'github run');
    if (!Number.isSafeInteger(run.id) || run.id < 1) throw new TypeError('github run id is invalid');
    boundedString(run.branch, 'github run branch', 120);
    if (!/^[a-f0-9]{40}$/i.test(run.headSha)) throw new TypeError('github run headSha is invalid');
    if (!RUN_STATUSES.has(run.status)) throw new TypeError('github run status is invalid');
    if (run.conclusion !== null && !CONCLUSIONS.has(run.conclusion)) throw new TypeError('github run conclusion is invalid');
    isoDate(run.updatedAt, 'github run updatedAt');
  }

  exactKeys(snapshot.render, ['serviceName', 'branch', 'plan', 'autoDeployEnabled', 'suspended', 'ipAllowList', 'latestDeploySha', 'latestDeployStatus'], 'render');
  boundedString(snapshot.render.serviceName, 'render.serviceName', 140);
  boundedString(snapshot.render.branch, 'render.branch', 120);
  if (!['free', 'standard', 'pro', 'other'].includes(snapshot.render.plan)) throw new TypeError('render.plan is invalid');
  if (typeof snapshot.render.autoDeployEnabled !== 'boolean' || typeof snapshot.render.suspended !== 'boolean') throw new TypeError('render flags are invalid');
  stringList(snapshot.render.ipAllowList, 'render.ipAllowList', 20, 80);
  if (!snapshot.render.ipAllowList.every(validCidr)) throw new TypeError('render.ipAllowList contains an invalid CIDR');
  if (snapshot.render.latestDeploySha !== null && !/^[a-f0-9]{7,40}$/i.test(snapshot.render.latestDeploySha)) throw new TypeError('render.latestDeploySha is invalid');
  if (snapshot.render.latestDeployStatus !== null && !DEPLOY_STATUSES.has(snapshot.render.latestDeployStatus)) throw new TypeError('render.latestDeployStatus is invalid');

  exactKeys(snapshot.cloudflare, ['workerNames', 'd1DatabaseCount', 'd1Capacity'], 'cloudflare');
  stringList(snapshot.cloudflare.workerNames, 'cloudflare.workerNames', 20, 140);
  for (const [key, value] of [['d1DatabaseCount', snapshot.cloudflare.d1DatabaseCount], ['d1Capacity', snapshot.cloudflare.d1Capacity]]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 100) throw new TypeError('cloudflare.' + key + ' is invalid');
  }
  if (snapshot.cloudflare.d1Capacity < 1 || snapshot.cloudflare.d1DatabaseCount > snapshot.cloudflare.d1Capacity) throw new TypeError('Cloudflare D1 capacity values are inconsistent');
  return snapshot;
}

function finding(id, severity, title, detail) {
  return Object.freeze({ id, severity, title, detail });
}

export function analyzeSnapshot(snapshot, { now = Date.now() } = {}) {
  validateSnapshot(snapshot, { now });
  const findings = [];
  const add = (...args) => findings.push(finding(...args));
  const age = now - Date.parse(snapshot.capturedAt);
  if (age > MAX_AGE_MS) add('snapshot_stale', 'WARN', 'اللقطة قديمة', 'مرّ أكثر من 24 ساعة على جمع البيانات؛ استورد لقطة حديثة قبل اتخاذ قرار إصدار.');
  else add('snapshot_fresh', 'PASS', 'حداثة اللقطة مقبولة', 'وقت جمع البيانات ضمن آخر 24 ساعة.');

  const gh = snapshot.github;
  if (gh.repository !== EXPECTED_REPOSITORY) add('github_repository_mismatch', 'BLOCKER', 'مستودع GitHub غير مطابق', 'المستودع المستورد لا يطابق مستودع OMDA المعزول المتوقع.');
  else add('github_repository_match', 'PASS', 'مستودع GitHub مطابق', 'المستودع يطابق APP-AI.');
  if (gh.branch !== EXPECTED_BRANCH) add('github_branch_mismatch', 'BLOCKER', 'فرع GitHub غير مطابق', 'الفرع المستورد ليس فرع التشغيل المعزول المعتمد.');
  else add('github_branch_match', 'PASS', 'فرع GitHub مطابق', 'الفرع يطابق فرع FreeLLMAPI المعزول.');
  if (!gh.branchProtected) add('branch_unprotected', 'BLOCKER', 'حماية الفرع غير مفعّلة', 'GitHub لا يفرض حماية الفرع؛ لا توجد ضمانة منصة تمنع دفعًا غير مراجع.');
  else add('branch_protected', 'PASS', 'حماية الفرع مفعّلة', 'لقطة GitHub تشير إلى تفعيل حماية الفرع.');
  if (gh.requiredChecks.length === 0) add('required_checks_missing', 'BLOCKER', 'لا توجد فحوص إلزامية', 'لم تُسجّل أي Required Status Checks على الفرع.');
  else add('required_checks_present', 'PASS', 'الفحوص الإلزامية موجودة', 'تم تسجيل ' + gh.requiredChecks.length + ' فحصًا إلزاميًا.');

  const matchingRuns = gh.runs.filter(run => run.branch === EXPECTED_BRANCH && run.headSha.toLowerCase() === gh.headSha.toLowerCase())
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const latestRun = matchingRuns[0];
  if (!latestRun) add('ci_missing', 'BLOCKER', 'لا يوجد CI للرأس الحالي', 'لم تُرفق نتيجة GitHub Actions تطابق الفرع وCommit الحاليين.');
  else if (latestRun.status !== 'completed') add('ci_pending', 'BLOCKER', 'فحوص CI لم تنتهِ', 'آخر تشغيل مطابق للرأس الحالي ما زال قيد التنفيذ أو الانتظار.');
  else if (latestRun.conclusion !== 'success') add('ci_failed', 'BLOCKER', 'فحوص CI لم تنجح', 'آخر تشغيل مكتمل مطابق للرأس الحالي لم ينتهِ بنتيجة success.');
  else if (now - Date.parse(latestRun.updatedAt) > MAX_AGE_MS) add('ci_stale', 'WARN', 'نتيجة CI قديمة', 'نجح CI للرأس الحالي، لكن نتيجته أقدم من 24 ساعة.');
  else add('ci_success', 'PASS', 'CI ناجح للرأس الحالي', 'آخر تشغيل مطابق للفرع وCommit الحالي مكتمل وناجح وحديث.');

  const render = snapshot.render;
  if (render.serviceName !== EXPECTED_RENDER_SERVICE) add('render_service_mismatch', 'BLOCKER', 'خدمة Render غير مطابقة', 'الخدمة المستوردة ليست خدمة Secure Staging المحددة للمشروع.');
  else add('render_service_match', 'PASS', 'خدمة Render مطابقة', 'الخدمة تطابق Secure Staging.');
  if (render.branch !== EXPECTED_BRANCH) add('render_branch_mismatch', 'BLOCKER', 'فرع Render غير مطابق', 'Render لا يتتبع فرع FreeLLMAPI المعزول المتوقع.');
  else add('render_branch_match', 'PASS', 'فرع Render مطابق', 'Render يتتبع الفرع المعزول المتوقع.');
  if (render.plan !== 'free') add('render_not_free', 'BLOCKER', 'خطة Render ليست مجانية', 'تتطلب مراجعة يدوية قبل أي تشغيل؛ لا يُسمح بترقية مدفوعة ضمن هذا المشروع.');
  else add('render_free', 'PASS', 'خطة Render مجانية', 'الخدمة على الخطة المجانية بحسب اللقطة.');
  if (render.autoDeployEnabled) add('render_auto_deploy', 'BLOCKER', 'النشر التلقائي مفعّل', 'أوقف النشر التلقائي يدويًا بعد مراجعة أثره؛ هذه الأداة لا تغيّر إعدادات Render.');
  else add('render_manual_deploy', 'PASS', 'النشر التلقائي متوقف', 'تظل عمليات النشر اليدوية خاضعة للمراجعة.');
  if (render.suspended) add('render_suspended', 'WARN', 'خدمة Render معلّقة', 'الخدمة معلّقة بحسب اللقطة؛ لا يمكن اعتبارها متاحة.');
  else add('render_not_suspended', 'PASS', 'خدمة Render غير معلّقة', 'حالة الخدمة في اللقطة ليست suspended؛ هذا لا يثبت صحة التطبيق.');
  if (render.ipAllowList.length === 0) add('render_allowlist_unknown', 'WARN', 'قائمة السماح غير متاحة', 'لم تتضمن اللقطة قواعد IP تسمح بتقييم محيط الشبكة.');
  else if (render.ipAllowList.some(rule => rule === '0.0.0.0/0' || rule === '::/0')) add('render_open_allowlist', 'BLOCKER', 'قائمة IP تسمح للجميع', 'تتضمن اللقطة قاعدة عامة؛ يلزم التحقق من Origin Gate وCloudflare Access قبل تشغيل مهام حساسة.');
  else add('render_restricted_allowlist', 'PASS', 'قائمة IP مقيدة', 'لا تتضمن اللقطة قاعدة IPv4 أو IPv6 عامة.');
  if (!render.latestDeploySha || !render.latestDeployStatus) add('render_deploy_unknown', 'WARN', 'آخر نشر غير موثق', 'لا توجد بيانات كافية عن Commit وحالة آخر نشر.');
  else if (render.latestDeployStatus !== 'live') add('render_deploy_not_live', 'BLOCKER', 'آخر نشر ليس Live', 'آخر حالة نشر مسجلة ليست live.');
  else if (render.latestDeploySha.toLowerCase() !== gh.headSha.toLowerCase()) add('render_deploy_behind', 'WARN', 'Staging لا يشغّل الرأس الحالي', 'Commit المنشور يختلف عن رأس الفرع الحالي؛ لم يُطلب أي نشر.');
  else add('render_deploy_current', 'PASS', 'Staging يطابق الرأس الحالي', 'Commit آخر نشر يطابق رأس الفرع بحسب اللقطة.');

  const workerSet = new Set(snapshot.cloudflare.workerNames);
  const missingWorkers = REQUIRED_WORKERS.filter(name => !workerSet.has(name));
  if (missingWorkers.length) add('cloudflare_workers_missing', 'WARN', 'بعض Workers غير موجودة في اللقطة', 'عدد المكونات المتوقعة غير الموجودة: ' + missingWorkers.length + '.');
  else add('cloudflare_workers_present', 'PASS', 'Workers الأساسية موجودة', 'تظهر مكونات Bridge وConsole وWatch وGateway في اللقطة.');
  const { d1DatabaseCount, d1Capacity } = snapshot.cloudflare;
  if (d1DatabaseCount === d1Capacity) add('d1_capacity_full', 'WARN', 'سعة D1 ممتلئة', 'الاستخدام ' + d1DatabaseCount + '/' + d1Capacity + '؛ لا تنشئ قاعدة جديدة ولا تعِد استخدام قاعدة مشروع آخر.');
  else add('d1_capacity_available', 'PASS', 'سعة D1 متاحة', 'الاستخدام ' + d1DatabaseCount + '/' + d1Capacity + ' بحسب اللقطة.');

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id));
  const counts = { BLOCKER: 0, WARN: 0, INFO: 0, PASS: 0 };
  for (const item of findings) counts[item.severity]++;
  const readiness = counts.BLOCKER ? 'BLOCKED' : counts.WARN ? 'CONDITIONAL' : 'REVIEW_READY';
  return Object.freeze({
    schemaVersion: 1,
    source: 'IMPORTED_SNAPSHOT_ONLY',
    assessedAt: new Date(now).toISOString(),
    readiness,
    deploymentPerformed: false,
    externalActionsPerformed: false,
    counts,
    facts: Object.freeze({
      repositoryMatches: gh.repository === EXPECTED_REPOSITORY,
      branchMatches: gh.branch === EXPECTED_BRANCH,
      renderBranchMatches: render.branch === EXPECTED_BRANCH,
      latestCiMatchesHead: Boolean(latestRun && latestRun.status === 'completed' && latestRun.conclusion === 'success'),
      renderDeployMatchesHead: Boolean(render.latestDeploySha && render.latestDeploySha.toLowerCase() === gh.headSha.toLowerCase()),
      d1Usage: d1DatabaseCount + '/' + d1Capacity,
      workerCount: workerSet.size
    }),
    findings
  });
}

export function analyzeSnapshotText(text, options = {}) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_INPUT_BYTES) throw new RangeError('Snapshot exceeds 64 KiB');
  let snapshot;
  try { snapshot = JSON.parse(text); } catch { throw new TypeError('Snapshot is not valid JSON'); }
  return analyzeSnapshot(snapshot, options);
}

function csvCell(value) {
  const raw = String(value ?? '');
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function exportReportJson(report) {
  if (!report || report.source !== 'IMPORTED_SNAPSHOT_ONLY' || !Array.isArray(report.findings)) throw new TypeError('Invalid report');
  return JSON.stringify(report, null, 2) + '\n';
}

export function exportReportCsv(report) {
  if (!report || report.source !== 'IMPORTED_SNAPSHOT_ONLY' || !Array.isArray(report.findings)) throw new TypeError('Invalid report');
  const rows = [['ID', 'Severity', 'Title', 'Detail'], ...report.findings.map(item => [item.id, item.severity, item.title, item.detail])];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
