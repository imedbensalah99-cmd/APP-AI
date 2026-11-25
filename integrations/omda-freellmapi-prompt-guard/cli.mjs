#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { scanPrompt, MAX_PROMPT_BYTES } from './engine.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node cli.mjs <prompt-file> [--format summary|redacted|json] [--strict]');
} else {
  let file = null;
  let format = 'summary';
  let strict = false;
  let formatSeen = false;
  let invalid = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--format') {
      if (formatSeen || !args[index + 1] || args[index + 1].startsWith('--')) { invalid = true; break; }
      formatSeen = true;
      format = args[index + 1];
      index += 1;
    } else if (value === '--strict') {
      if (strict) { invalid = true; break; }
      strict = true;
    } else if (value.startsWith('--') || file !== null) {
      invalid = true;
      break;
    } else {
      file = value;
    }
  }

  if (invalid || !file || !['summary', 'redacted', 'json'].includes(format)) {
    console.error('Usage: node cli.mjs <prompt-file> [--format summary|redacted|json] [--strict]');
    process.exitCode = 2;
  } else {
    try {
      const stat = statSync(file);
      if (!stat.isFile() || stat.size > MAX_PROMPT_BYTES) throw new Error('input_file_limit');
      const input = readFileSync(file, 'utf8');
      const result = scanPrompt(input);
      if (format === 'redacted') {
        process.stdout.write(result.sanitizedPrompt + (result.sanitizedPrompt.endsWith('\n') || !result.sanitizedPrompt ? '' : '\n'));
      } else if (format === 'json') {
        process.stdout.write(JSON.stringify({
          counts: result.counts,
          categories: result.categories,
          findings: result.findings,
          sanitizedPrompt: result.sanitizedPrompt,
          inputChars: result.inputChars,
          inputBytes: result.inputBytes,
        }, null, 2) + '\n');
      } else {
        process.stdout.write([
          'Prompt Data Guard',
          'Findings: ' + result.counts.total,
          'Critical: ' + result.counts.critical,
          'High: ' + result.counts.high,
          'Medium: ' + result.counts.medium,
          'Redacted ranges: ' + result.redactedRanges,
        ].join('\n') + '\n');
      }
      if (strict && result.counts.total > 0) process.exitCode = 1;
    } catch {
      console.error('Unable to scan input. Check that it is a UTF-8 text file within the configured limits.');
      process.exitCode = 2;
    }
  }
}
