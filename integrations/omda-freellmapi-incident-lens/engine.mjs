// OMDA Incident Lens — local-only, bounded and deterministic log triage.
// Never sends, stores, or executes supplied log content.
const MAX_BYTES = 256 * 1024;
const MAX_LINES = 2500;
const MAX_LINE_CHARS = 2000;
const SEVERITY_ORDER = Object.freeze({critical:0,high:1,medium:2,low:3,info:4});
const ACTIONS = Object.freeze({
  authentication: 'Verify the expected authentication header and token source. Never paste credentials into a report.',
  authorization: 'Check the owner-only Cloudflare Access policy and origin guard. Do not make the origin public to bypass the failure.',
  not_found: 'Verify the exact route, API version, deployment branch and health-check path.',
  rate_limit: 'Inspect the configured quota window and apply bounded backoff. Do not retry in a loop.',
  upstream: 'Check the upstream service health, proxy timeout and latest successful deployment.',
  unavailable: 'Check service suspension, instance health and resource limits before retrying.',
  timeout: 'Check dependency availability and request deadlines; keep retries bounded.',
  memory: 'Inspect memory limits and recent workload growth. Reduce concurrency and avoid unbounded jobs.',
  deployment: 'Review the failed build/deploy step and pinned runtime or image version.',
  application: 'Review the sanitized stack trace and correlation ID; reproduce with synthetic input.',
  other: 'Review the sanitized sample and correlate it with a known request or deployment.'
});
const SECRET_RULES = Object.freeze([
  [/\b(authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;]+/gi, '$1[REDACTED]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]'],
  [/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g, '[REDACTED_TOKEN]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]'],
  [/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|cf_access_token|x-auth-token)\s*[:=]\s*)["']?[^"'\\s,;&]+/gi, '$1[REDACTED]'],
  [/([?&](?:token|key|secret|password|signature|code|authorization|access_token)=)[^&#\s]+/gi, '$1[REDACTED]'],
  [/\b(set-cookie|cookie)\s*[:=]\s*[^\r\n]+/gi, '$1: [REDACTED]'],
  [/\b(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1[REDACTED]@'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]']
]);
function assertInput(input) {
  if (typeof input !== 'string' || input.trim().length === 0) throw new TypeError('Provide non-empty log text');
  const bytes = new TextEncoder().encode(input).byteLength;
  if (bytes > MAX_BYTES) throw new RangeError('Log input exceeds 256 KiB');
  const lines = input.split(/\r\n|\n|\r/);
  if (lines.length > MAX_LINES) throw new RangeError('Log input exceeds 2,500 lines');
  return lines;
}
function sanitizeLine(value) {
  let text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
  let redacted = false;
  for (const [pattern, replacement] of SECRET_RULES) {
    pattern.lastIndex = 0;
    const next = text.replace(pattern, replacement);
    if (next !== text) redacted = true;
    text = next;
  }
  const truncated = text.length > MAX_LINE_CHARS;
  if (truncated) text = text.slice(0, MAX_LINE_CHARS) + ' [TRUNCATED]';
  return {text: text.trim(), redacted, truncated};
}
function statusCodeOf(text) {
  const patterns = [
    /\b(?:HTTP\/\d(?:\.\d)?\s+)(401|403|404|408|429|500|502|503|504)\b/i,
    /\b(?:status(?:_code|code)?|http_status)\s*[=: ]\s*(401|403|404|408|429|500|502|503|504)\b/i,
    /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+\S+\s+(401|403|404|408|429|500|502|503|504)\b/i,
    /\b(?:returned|response|upstream|error)\s+(401|403|404|408|429|500|502|503|504)\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}
function classify(text) {
  const statusCode = statusCodeOf(text);
  if (/out of memory|oom-kill|oom killed|heap out of memory|memory limit exceeded|killed process/i.test(text))
    return {category:'memory',severity:'critical',statusCode};
  if (statusCode === 401 || /unauthori[sz]ed|invalid (?:access )?token|authentication failed|missing bearer/i.test(text))
    return {category:'authentication',severity:'high',statusCode};
  if (statusCode === 403 || /forbidden|origin gate|access denied|policy denied/i.test(text))
    return {category:'authorization',severity:'high',statusCode};
  if (statusCode === 404 || /route not found|no route matches|not found/i.test(text))
    return {category:'not_found',severity:'low',statusCode};
  if (statusCode === 429 || /rate.?limit|too many requests|quota exceeded|quota exhausted/i.test(text))
    return {category:'rate_limit',severity:'medium',statusCode};
  if (statusCode === 502 || /bad gateway|upstream reset|upstream connect error/i.test(text))
    return {category:'upstream',severity:'high',statusCode};
  if (statusCode === 503 || /service unavailable|instance unavailable|service suspended/i.test(text))
    return {category:'unavailable',severity:'high',statusCode};
  if (statusCode === 408 || statusCode === 504 || /timed? ?out|timeout|etimedout|econnreset|deadline exceeded/i.test(text))
    return {category:'timeout',severity:'medium',statusCode};
  if (/docker build|image pull|deployment failed|build failed|deploy failed|health check failed/i.test(text))
    return {category:'deployment',severity:'high',statusCode};
  if (/\b(error|exception|fatal|traceback|uncaught)\b/i.test(text))
    return {category:'application',severity:'medium',statusCode};
  return {category:'info',severity:'info',statusCode};
}
function fingerprint(text, category, statusCode) {
  const normalized = text.toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hash>')
    .replace(/\b\d+\b/g, '#')
    .replace(/\s+/g, ' ').trim().slice(0, 180);
  return category + '|' + (statusCode ?? '') + '|' + normalized;
}
function analyzeLogs(input) {
  const sourceLines = assertInput(input);
  const lines = [];
  let redactedLines = 0;
  let truncatedLines = 0;
  for (let i = 0; i < sourceLines.length; i++) {
    if (!sourceLines[i].trim()) continue;
    const safe = sanitizeLine(sourceLines[i]);
    if (safe.redacted) redactedLines++;
    if (safe.truncated) truncatedLines++;
    const result = classify(safe.text);
    lines.push({line:i+1,text:safe.text,category:result.category,severity:result.severity,statusCode:result.statusCode,redacted:safe.redacted,truncated:safe.truncated});
  }
  if (!lines.length) throw new TypeError('No non-empty log lines found');
  const groups = new Map();
  const bySeverity = {critical:0,high:0,medium:0,low:0,info:0};
  for (const line of lines) {
    bySeverity[line.severity]++;
    if (line.category === 'info') continue;
    const key = fingerprint(line.text,line.category,line.statusCode);
    const current = groups.get(key);
    if (current) {
      current.count++;
      current.lastLine = line.line;
    } else {
      groups.set(key,{id:'INC-'+String(groups.size+1).padStart(3,'0'),category:line.category,severity:line.severity,statusCode:line.statusCode,count:1,firstLine:line.line,lastLine:line.line,sample:line.text.slice(0,240),recommendedAction:ACTIONS[line.category] ?? ACTIONS.other});
    }
  }
  const incidents = [...groups.values()].sort((a,b)=>
    SEVERITY_ORDER[a.severity]-SEVERITY_ORDER[b.severity] || b.count-a.count || a.firstLine-b.firstLine);
  return {
    schemaVersion:1,
    source:'local-sanitized-log-analysis',
    summary:{totalLines:sourceLines.length,analyzedLines:lines.length,redactedLines,truncatedLines,incidentGroups:incidents.length,bySeverity},
    incidents,
    lines
  };
}
function csvCell(value) {
  const raw = String(value ?? '');
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replace(/"/g,'""') + '"';
}
function assertReport(report) {
  if (!report || typeof report !== 'object' || report.schemaVersion !== 1 ||
      report.source !== 'local-sanitized-log-analysis' || !Array.isArray(report.incidents) ||
      !Array.isArray(report.lines) || report.lines.length > MAX_LINES) throw new TypeError('Invalid sanitized report');
}
function exportJSON(report) {
  assertReport(report);
  return JSON.stringify(report,null,2) + '\n';
}
function exportCSV(report) {
  assertReport(report);
  const rows = [['Incident ID','Category','Severity','HTTP status','Count','First line','Last line','Sample (sanitized)','Recommended action']];
  for (const incident of report.incidents) rows.push([incident.id,incident.category,incident.severity,incident.statusCode ?? '',incident.count,incident.firstLine,incident.lastLine,incident.sample,incident.recommendedAction]);
  return '\uFEFF' + rows.map(row=>row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export {analyzeLogs,exportJSON,exportCSV,MAX_BYTES,MAX_LINES,MAX_LINE_CHARS};
