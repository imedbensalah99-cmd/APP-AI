// One-shot, no-secret Agent Watch snapshot collector.
// Exactly two anonymous GETs to the fixed Render Staging origin; no prompts or writes.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://omda-freellmapi-secure-staging-v1.onrender.com';
const ROUTES = Object.freeze(['/api/ping', '/v1/models']);

function classify(health, models) {
  if (health === 200 && models === 403) return 'PERIMETER_OK';
  if (models === 200) return 'ORIGIN_GATE_OPEN';
  if (health === 0 || models === 0) return 'NETWORK_UNAVAILABLE';
  return 'PERIMETER_NOT_READY';
}

async function collectSnapshot(fetcher = fetch, now = () => new Date().toISOString(), id = randomUUID) {
  const codes = [];
  for (const route of ROUTES) {
    try {
      const response = await fetcher(`${ORIGIN}${route}`, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      codes.push(Number.isInteger(response?.status) && response.status >= 0 && response.status <= 599 ? response.status : 0);
    } catch {
      codes.push(0);
    }
  }
  const [health, models] = codes;
  return {
    results: [{
      id: id(),
      created_at: now(),
      health_http: health,
      model_http: models,
      verdict: classify(health, models),
    }],
  };
}

async function main() {
  const snapshot = await collectSnapshot();
  const row = snapshot.results[0];
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  if (row.verdict !== 'PERIMETER_OK') process.exitCode = 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();

export { ORIGIN, ROUTES, classify, collectSnapshot };
