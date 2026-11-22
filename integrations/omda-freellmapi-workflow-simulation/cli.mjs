#!/usr/bin/env node
// Offline Workflow Simulation CLI. Reads one JSON plan and writes only to stdout.
import { stat, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { simulatePlan, exportJSON, exportCSV, MAX_PLAN_BYTES } from './engine.mjs';

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (args.length < 1 || args[0].startsWith('--')) throw new Error('A plan JSON file is required');
  const result = {
    file: args[0], format: 'json',
    options: { concurrency: 2, defaultMinutes: 30, approvalWaitMinutes: 0 }
  };
  for (let index = 1; index < args.length; index++) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('Missing option value');
    if (flag === '--format') {
      if (value !== 'json' && value !== 'csv') throw new Error('Format must be json or csv');
      result.format = value;
    } else if (flag === '--concurrency') {
      result.options.concurrency = Number(value);
    } else if (flag === '--minutes') {
      result.options.defaultMinutes = Number(value);
    } else if (flag === '--approval-wait') {
      result.options.approvalWaitMinutes = Number(value);
    } else {
      throw new Error('Unknown CLI option');
    }
    index++;
  }
  return result;
}
function helpText() {
  return [
    'OMDA Workflow Simulation Lab',
    'Usage: node cli.mjs <plan.json> [--format json|csv] [--concurrency 1..4]',
    '       [--minutes 1..1440] [--approval-wait 0..720]',
    'The CLI reads one bounded JSON file and writes a simulation report to stdout.',
    'It never executes tasks, accesses the network, or writes output files.'
  ].join('\n') + '\n';
}
async function main(args) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    process.stdout.write(helpText());
    return;
  }
  const info = await stat(parsed.file);
  if (!info.isFile() || info.size > MAX_PLAN_BYTES) throw new Error('Plan file must be a regular file no larger than 128 KiB');
  const source = await readFile(parsed.file, 'utf8');
  if (Buffer.byteLength(source, 'utf8') > MAX_PLAN_BYTES) throw new Error('Plan file exceeds 128 KiB');
  const plan = JSON.parse(source);
  const result = simulatePlan(plan, parsed.options);
  process.stdout.write(parsed.format === 'csv' ? exportCSV(result) : exportJSON(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write('Simulation failed: ' + String(error.message || 'Invalid input') + '\n');
    process.exitCode = 2;
  });
}
export { parseArgs, helpText, main };
