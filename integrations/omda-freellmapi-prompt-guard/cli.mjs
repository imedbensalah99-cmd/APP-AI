#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { scanPrompt, MAX_PROMPT_BYTES } from './engine.mjs';

const args = process.argv.slice(2);
const file = args.find(value => !value.startsWith('--'));
const formatIndex = args.indexOf('--format');
const format = formatIndex >= 0 ? args[formatIndex + 1] : 'summary';
const strict = args.includes('--strict');
const allowedFlags = new Set(['--format', '--strict']);
const unknown = args.filter((value, index) => value.startsWith('--') && !allowedFlags.has(value));
if (unknown.length || args.filter(value => value === '--format').length > 1) {
  console.error('Invalid arguments. Use --format summary|redacted|json and optional --strict.');
  process.exitCode = 2;
} else if (args.includes('--help')) {
  console.log('Usage: node cli.mjs <prompt-file> [--format summary|redacted|json] [--strict]');
} else if (!file || !['summary', 'redacted', 'json'].includes(format) || (formatIndex >= 0 && !args[formatIndex + 1])) {
  console.error('Usage: node cli.mjs <prompt-file> [--format summary|redacted|json] [--strict]');
  process.exitCode = 2;
} else {
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > MAX_PROMPT_BYTES) throw new Error('input_file_limit');
    const input = readFileSync(file, 'utf8');
    const result = scanPrompt(input);
    if (format === 'redacted') {
      process.stdout.write(result.sanitizedPrompt + (result.sanitizedPrompt.endsWith('\\n') || !result.sanitizedPrompt ? '' : '\\n'));
    } else if (format === 'json') {
      process.stdout.write(JSON.stringify({
        counts: result.counts,
        categories: result.categories,
        findings: result.findings,
        sanitizedPrompt: result.sanitizedPrompt,
        inputChars: result.inputChars,
        inputBytes: result.inputBytes,
      }, null, 2) + '\\n');
    } else {
      process.stdout.write([
        'Prompt Data Guard',
        'Findings: ' + result.counts.total,
        'Critical: ' + result.counts.critical,
        'High: ' + result.counts.high,
        'Medium: ' + result.counts.medium,
        'Redacted ranges: ' + result.redactedRanges,
      ].join('\\n') + '\\n');
    }
    if (strict && result.counts.total > 0) process.exitCode = 1;
  } catch {
    console.error('Unable to scan input. Check that it is a UTF-8 text file within the configured limits.');
    process.exitCode = 2;
  }
}
