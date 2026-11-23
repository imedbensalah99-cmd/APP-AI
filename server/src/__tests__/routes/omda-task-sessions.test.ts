import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';
import { createUser, createSession } from '../../services/auth.js';
import { down as downTaskSessions } from '../../db/migrations/20261123_000001_omda_task_sessions.js';

let app: Express;
let dashToken = '';
let originalEncryptionKey: string | undefined;

async function request(method: string, path: string, body?: unknown, withAuth = true) {
  const server = app.listen(0);
  const addr = server.address() as { port: number };
  try {
    const res = await fetch('http://127.0.0.1:' + addr.port + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(withAuth && isGatedApiPath(path) ? { Authorization: 'Bearer ' + dashToken } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe('OMDA Task Sessions API', () => {
  beforeAll(() => {
    originalEncryptionKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken('task-sessions@example.com');
  });

  afterAll(() => {
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
    getDb().close?.();
  });

  it('requires dashboard authentication and rejects unknown request fields', async () => {
    const unauthenticated = await request('GET', '/api/omda/task-sessions', undefined, false);
    expect(unauthenticated.status).toBe(401);

    const invalid = await request('POST', '/api/omda/task-sessions', {
      label: 'Release review',
      planSha256: 'a'.repeat(64),
      command: 'must not be accepted',
    });
    expect(invalid.status).toBe(400);
  });

  it('enforces the route-specific 8 KiB JSON parser limit', async () => {
    const tooLarge = await request('POST', '/api/omda/task-sessions', {
      label: 'x'.repeat(9_000), planSha256: 'a'.repeat(64),
    });
    expect(tooLarge.status).toBe(413);
  });

  it('creates, pauses, resumes and completes a session with a verifiable event ledger', async () => {
    const created = await request('POST', '/api/omda/task-sessions', {
      label: 'Morning release validation',
      planSha256: 'A'.repeat(64),
    });
    expect(created.status).toBe(201);
    expect(created.body.session).toMatchObject({ status: 'draft', revision: 0, planSha256: 'a'.repeat(64) });
    expect(created.body.events).toHaveLength(1);
    const id = created.body.session.id as string;

    const started = await request('POST', '/api/omda/task-sessions/' + id + '/transitions', {
      action: 'start', expectedRevision: 0,
    });
    expect(started.status).toBe(200);
    expect(started.body.session).toMatchObject({ status: 'running', revision: 1 });

    const paused = await request('POST', '/api/omda/task-sessions/' + id + '/transitions', {
      action: 'pause', expectedRevision: 1, note: 'Awaiting human review',
    });
    expect(paused.status).toBe(200);
    expect(paused.body.session).toMatchObject({ status: 'paused', revision: 2 });

    const resumed = await request('POST', '/api/omda/task-sessions/' + id + '/transitions', {
      action: 'resume', expectedRevision: 2,
    });
    expect(resumed.status).toBe(200);
    expect(resumed.body.session).toMatchObject({ status: 'running', revision: 3 });

    const completed = await request('POST', '/api/omda/task-sessions/' + id + '/transitions', {
      action: 'complete', expectedRevision: 3, note: 'Validation evidence attached',
    });
    expect(completed.status).toBe(200);
    expect(completed.body.session).toMatchObject({ status: 'completed', revision: 4 });
    expect(completed.body.events).toHaveLength(5);

    const verified = await request('GET', '/api/omda/task-sessions/' + id + '/verify');
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ valid: true, eventCount: 5 });
  });

  it('uses optimistic revisions and requires completion/failure evidence', async () => {
    const created = await request('POST', '/api/omda/task-sessions', {
      label: 'Stale write check', planSha256: 'b'.repeat(64),
    });
    const id = created.body.session.id as string;

    const stale = await request('POST', '/api/omda/task-sessions/' + id + '/transitions', {
      action: 'start', expectedRevision: 4,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.type).toBe('revision_conflict');

    await request('POST', '/api/omda/task-sessions/' + id + '/transitions', { action: 'start', expectedRevision: 0 });
    const missingEvidence = await request('POST', '/api/omda/task-sessions/' + id + '/transitions', {
      action: 'complete', expectedRevision: 1, note: 'ok',
    });
    expect(missingEvidence.status).toBe(400);
    expect(missingEvidence.body.error.type).toBe('evidence_note_required');
  });

  it('isolates sessions by authenticated user and rejects unsafe identifiers', async () => {
    const created = await request('POST', '/api/omda/task-sessions', {
      label: 'Owner isolation', planSha256: 'c'.repeat(64),
    });
    const id = created.body.session.id as string;
    const secondUser = createUser('other-task-user@example.com', 'password123');
    const originalToken = dashToken;
    dashToken = createSession(secondUser.userId);
    try {
      const hidden = await request('GET', '/api/omda/task-sessions/' + id);
      expect(hidden.status).toBe(404);
    } finally {
      dashToken = originalToken;
    }
    const invalidId = await request('GET', '/api/omda/task-sessions/not-a-uuid');
    expect(invalidId.status).toBe(400);
  });

  it('detects tampering and refuses destructive migration rollback while history exists', async () => {
    const created = await request('POST', '/api/omda/task-sessions', {
      label: 'Tamper check', planSha256: 'd'.repeat(64),
    });
    const id = created.body.session.id as string;
    getDb().prepare('UPDATE omda_task_session_events SET event_hash = ? WHERE session_id = ? AND seq = 0')
      .run('f'.repeat(64), id);

    const verified = await request('GET', '/api/omda/task-sessions/' + id + '/verify');
    expect(verified.body).toMatchObject({ valid: false, reason: 'event_hash_mismatch' });
    expect(() => downTaskSessions(getDb())).toThrow(/retained audit history/i);
  });
});
