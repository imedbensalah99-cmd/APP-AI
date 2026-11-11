import { createServer } from 'node:http';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { omdaTasksRouter } from './omda-tasks.js';
import { requireAuth } from '../middleware/requireAuth.js';

async function withServer<T>(run: (origin: string) => Promise<T>, protectedRoute = false): Promise<T> {
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  if (protectedRoute) app.use('/api/omda/tasks', requireAuth, omdaTasksRouter);
  else app.use('/api/omda/tasks', omdaTasksRouter);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  try {
    return await run('http://127.0.0.1:' + address.port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe('OMDA task planner route', () => {
  it('returns a bounded multi-intent plan without performing side effects', async () => {
    await withServer(async origin => {
      const response = await fetch(origin + '/api/omda/tasks/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'Create an Excel tracker and draft an email', locale: 'en' }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await response.json() as { categories: string[]; mode: string; guardrails: { externalWrites: boolean } };
      expect(body.categories).toEqual(['spreadsheet', 'email_draft']);
      expect(body.mode).toBe('plan_only');
      expect(body.guardrails.externalWrites).toBe(false);
    });
  });

  it('rejects unknown fields and invalid locale values', async () => {
    await withServer(async origin => {
      const response = await fetch(origin + '/api/omda/tasks/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'Create a job tracker', locale: 'fr', execute: true }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as { error: { type: string } };
      expect(body.error.type).toBe('invalid_request_error');
    });
  });

  it('rejects requests that exceed the input bound', async () => {
    await withServer(async origin => {
      const response = await fetch(origin + '/api/omda/tasks/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'x'.repeat(4001) }),
      });
      expect(response.status).toBe(400);
    });
  });

  it('rejects unauthenticated requests when mounted behind the dashboard session gate', async () => {
    await withServer(async origin => {
      const response = await fetch(origin + '/api/omda/tasks/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'Create a job tracker' }),
      });
      expect(response.status).toBe(401);
      const body = await response.json() as { error: { type: string } };
      expect(body.error.type).toBe('authentication_error');
    }, true);
  });
});
