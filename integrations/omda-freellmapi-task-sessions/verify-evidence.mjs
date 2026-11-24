#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { verifyTaskSessionEvidenceBundle, MAX_EVIDENCE_BUNDLE_BYTES } from './evidence-core.mjs';
function usage() {
  process.stdout.write('Usage: node verify-evidence.mjs <bundle.json> [--format text|json]\n');
  process.stdout.write('Offline verifier. Exit: 0 valid, 1 invalid, 2 input/usage error.\n');
}
function parseArgs(args) {
  let file = null, format = 'text';
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value === '--help' || value === '-h') return { help: true };
    if (value === '--format') {
      const next = args[i + 1];
      if (next !== 'text' && next !== 'json') throw new Error('format_must_be_text_or_json');
      format = next; i += 1; continue;
    }
    if (value.startsWith('-') || file !== null) throw new Error('invalid_arguments');
    file = value;
  }
  if (!file) throw new Error('missing_bundle_file');
  return { file, format, help: false };
}
async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write('Input error: ' + error.message + '\n'); usage(); process.exitCode = 2; return; }
  if (args.help) { usage(); return; }
  let raw;
  try {
    const stat = statSync(args.file);
    if (!stat.isFile()) throw new Error('not_a_regular_file');
    if (stat.size > MAX_EVIDENCE_BUNDLE_BYTES) throw new Error('bundle_too_large');
    raw = readFileSync(args.file, 'utf8');
  } catch (error) { process.stderr.write('Input error: ' + error.message + '\n'); process.exitCode = 2; return; }
  let bundle;
  try { bundle = JSON.parse(raw); }
  catch { process.stderr.write('Input error: invalid_json\n'); process.exitCode = 2; return; }
  const result = await verifyTaskSessionEvidenceBundle(bundle);
  if (args.format === 'json') {
    process.stdout.write(JSON.stringify({ valid: result.valid, reason: result.reason, summary: result.summary }) + '\n');
  } else if (result.valid) {
    process.stdout.write('VALID — task session evidence chain and bundle digest verified\n');
    process.stdout.write('Session: ' + result.summary.sessionId + '\n');
    process.stdout.write('Status: ' + result.summary.status + ' · Revision: ' + result.summary.revision + '\n');
    process.stdout.write('Events: ' + result.summary.eventCount + '\n');
    process.stdout.write('Bundle SHA-256: ' + result.summary.bundleSha256 + '\n');
  } else process.stdout.write('INVALID — ' + result.reason + '\n');
  process.exitCode = result.valid ? 0 : 1;
}
main().catch(() => { process.stderr.write('Verification failed unexpectedly\n'); process.exitCode = 2; });
