export const MAX_PROMPT_CHARS = 8_000;
export const MAX_PROMPT_BYTES = 16 * 1024;

const SEVERITY_RANK = { critical: 3, high: 2, medium: 1 };
const PATTERNS = [
  { id: 'private-key', label: 'Private key block', category: 'secret', severity: 'critical', source: '-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\\s\\S]{1,6000}?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----', flags: 'g' },
  { id: 'url-userinfo', label: 'Credentials embedded in URL', category: 'secret', severity: 'critical', source: '\\bhttps?:\\/\\/[^\\s/:@]+:[^\\s/@]+@[^\\s/]+(?:\\/[^\\s]*)?', flags: 'gi' },
  { id: 'credit-card', label: 'Possible payment card number', category: 'financial', severity: 'high', source: '(?<!\\d)(?:\\d[ -]?){12,18}\\d(?!\\d)', flags: 'g', validate: 'luhn' },
  { id: 'bearer-token', label: 'Bearer token', category: 'secret', severity: 'high', source: '\\bBearer\\s+[A-Za-z0-9._~+/-]{12,}={0,2}', flags: 'gi' },
  { id: 'jwt', label: 'JWT-like token', category: 'secret', severity: 'high', source: '\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\b', flags: 'g' },
  { id: 'openai-key', label: 'OpenAI-style API key', category: 'secret', severity: 'high', source: '\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b', flags: 'g' },
  { id: 'github-token', label: 'GitHub token', category: 'secret', severity: 'high', source: '\\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\\b', flags: 'g' },
  { id: 'gitlab-token', label: 'GitLab token', category: 'secret', severity: 'high', source: '\\bglpat-[A-Za-z0-9_-]{20,}\\b', flags: 'g' },
  { id: 'aws-key-id', label: 'AWS access key identifier', category: 'secret', severity: 'high', source: '\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b', flags: 'g' },
  { id: 'google-api-key', label: 'Google API key', category: 'secret', severity: 'high', source: '\\bAIza[0-9A-Za-z_-]{35}\\b', flags: 'g' },
  { id: 'slack-token', label: 'Slack token', category: 'secret', severity: 'high', source: '\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b', flags: 'g' },
  { id: 'credential-assignment', label: 'Credential-like assignment', category: 'secret', severity: 'high', source: '\\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|password|passwd|authorization)\\b\\s*[:=]\\s*(?:"[^"\\r\\n]{4,}"|\'[^\'\\r\\n]{4,}\'|[^\\s,;]{4,})', flags: 'gi' },
  { id: 'url-query-secret', label: 'Secret in URL query parameter', category: 'secret', severity: 'high', source: '[?&](?:access_token|api[_-]?key|token|secret|password|signature)=([^&#\\s]{8,})', flags: 'gi' },
  { id: 'email', label: 'Email address', category: 'personal', severity: 'medium', source: '\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b', flags: 'gi' },
  { id: 'international-phone', label: 'International phone number', category: 'personal', severity: 'medium', source: '(?<!\\d)(?:\\+|00)\\d[\\d\\s().-]{7,}\\d(?!\\d)', flags: 'g' },
  { id: 'qatar-mobile', label: 'Possible Qatar mobile number', category: 'personal', severity: 'medium', source: '(?<!\\d)(?:\\+?974[\\s-]?)?[3567]\\d{7}(?!\\d)', flags: 'g' },
  { id: 'qatar-id', label: 'Possible 11-digit Qatar ID', category: 'personal', severity: 'medium', source: '(?<!\\d)\\d{11}(?!\\d)', flags: 'g' },
];

function isLuhnValid(value) {
  const digits = value.replace(/\\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function collectFindings(input) {
  const byRange = new Map();
  for (const pattern of PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    for (const match of input.matchAll(regex)) {
      const value = match[0];
      if (pattern.validate === 'luhn' && !isLuhnValid(value)) continue;
      const start = match.index ?? 0;
      const end = start + value.length;
      const key = start + ':' + end;
      const finding = {
        id: pattern.id,
        label: pattern.label,
        category: pattern.category,
        severity: pattern.severity,
        start,
        end,
      };
      const existing = byRange.get(key);
      if (!existing || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[existing.severity]) {
        byRange.set(key, finding);
      }
    }
  }
  return [...byRange.values()].sort((a, b) => a.start - b.start || b.end - a.end);
}

function mergeRanges(findings) {
  const ranges = [];
  for (const finding of findings) {
    const previous = ranges[ranges.length - 1];
    if (previous && finding.start <= previous.end) {
      previous.end = Math.max(previous.end, finding.end);
      previous.categories.add(finding.category);
    } else {
      ranges.push({ start: finding.start, end: finding.end, categories: new Set([finding.category]) });
    }
  }
  return ranges;
}

function redactRanges(input, findings) {
  const ranges = mergeRanges(findings);
  let cursor = 0;
  let output = '';
  for (const range of ranges) {
    output += input.slice(cursor, range.start);
    const category = range.categories.size === 1 ? [...range.categories][0] : 'sensitive-data';
    output += '[REDACTED:' + category + ']';
    cursor = range.end;
  }
  return output + input.slice(cursor);
}

/**
 * Scan untrusted prompt text without logging or persisting it.
 * Findings intentionally contain offsets and labels, never matched values.
 */
export function scanPrompt(input) {
  if (typeof input !== 'string') throw new TypeError('prompt_must_be_text');
  if (input.length > MAX_PROMPT_CHARS) throw new RangeError('prompt_character_limit_exceeded');
  const inputBytes = byteLength(input);
  if (inputBytes > MAX_PROMPT_BYTES) throw new RangeError('prompt_byte_limit_exceeded');

  const findings = collectFindings(input);
  const counts = { critical: 0, high: 0, medium: 0, total: findings.length };
  const categories = { secret: 0, personal: 0, financial: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
    categories[finding.category] += 1;
  }
  return {
    findings,
    counts,
    categories,
    sanitizedPrompt: redactRanges(input, findings),
    inputChars: input.length,
    inputBytes,
    redactedRanges: mergeRanges(findings).length,
  };
}

export function redactPrompt(input) {
  return scanPrompt(input).sanitizedPrompt;
}
