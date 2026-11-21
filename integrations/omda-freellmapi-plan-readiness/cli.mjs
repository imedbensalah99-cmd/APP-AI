#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { analyzePlanJson, exportReportJSON, exportReportCSV, MAX_PLAN_BYTES } from './engine.mjs';

const HELP = [
  'OMDA Plan Readiness Analyzer',
  'Usage: node cli.mjs <plan.json> [--format text|json|csv] [--fail-on-review]',
  'Exit codes: 0 ready/review, 1 blocked (or review with --fail-on-review), 2 invalid input.',
  'This CLI is offline-only. It reads one local JSON file and writes the report to stdout.'
].join('\n');

function parseArgs(args) {
  let file = null;
  let format = 'text';
  let failOnReview = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--fail-on-review') { failOnReview = true; continue; }
    if (arg === '--format') {
      format = args[++i];
      if (!format) throw new Error('Missing --format value');
      continue;
    }
    if (arg.startsWith('--format=')) { format = arg.slice(9); continue; }
    if (arg.startsWith('-')) throw new Error('Unknown option: ' + arg);
    if (file !== null) throw new Error('Only one input plan file is accepted');
    file = arg;
  }
  if (!file) throw new Error('A plan JSON file is required');
  if (!['text', 'json', 'csv'].includes(format)) throw new Error('Format must be text, json, or csv');
  return { file, format, failOnReview };
}

function textReport(report) {
  const lines = [
    'OMDA Plan Readiness',
    'Decision: ' + report.decision,
    'Score: ' + report.score + '/100',
    'Steps: ' + report.summary.totalSteps,
    'Protected workstreams: ' + report.summary.protectedWorkstreams,
    'Gated workstreams: ' + report.summary.gatedWorkstreams,
    'Findings: ' + report.summary.findings,
    'Plan SHA-256: ' + report.planDigest
  ];
  for (const finding of report.findings) {
    lines.push('[' + finding.severity.toUpperCase() + '] ' + finding.code +
      (finding.stepId ? ' (' + finding.stepId + ')' : '') + ': ' + finding.message);
    lines.push('  Recommendation: ' + finding.recommendation);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(error.message + '\n' + HELP + '\n');
    process.exitCode = 2;
    return;
  }
  if (parsed.help) {
    process.stdout.write(HELP + '\n');
    return;
  }
  try {
    const info = await stat(parsed.file);
    if (!info.isFile()) throw new Error('Input path must be a regular file');
    if (info.size > MAX_PLAN_BYTES) throw new Error('Plan JSON exceeds 128 KiB');
    const source = await readFile(parsed.file, 'utf8');
    const report = await analyzePlanJson(source);
    if (parsed.format === 'json') process.stdout.write(exportReportJSON(report));
    else if (parsed.format === 'csv') process.stdout.write(exportReportCSV(report));
    else process.stdout.write(textReport(report));
    process.exitCode = report.decision === 'BLOCKED' ||
      (parsed.failOnReview && report.decision === 'REVIEW') ? 1 : 0;
  } catch (error) {
    process.stderr.write((error && error.message ? error.message : 'Analysis failed') + '\n');
    process.exitCode = 2;
  }
}

await main();
