import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { getDb, initDb } from '../../db/index.js';
import { down as downAssignments } from '../../db/migrations/20261128_000001_omda_worker_session_assignments.js';
import { mintDashboardToken } from '../helpers/auth.js';
import { createSession, createUser } from '../../services/auth.js';

let app: Express;
let dashboardToken = '';
let originalEncryptionKey: string | undefined;

async function request(method: string, path: string, body?: unknown, token: string | null = dashboardToken) {
  const server = app.listen(0);
  const address = server.address() as { port: number };
  try {
    const response = await fetch('http://127.0.0.1:' + address.port + path, {
      method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
async function createWorker(label: string) {
  const response = await request('POST', '/api/omda/workers', { label });
  expect(response.status).toBe(201);
  return response.body as { worker: { id: string; workerId: string }; workerToken: string };
}
async function createRunningSession(label: string, token = dashboardToken): Promise<string> {
  const created = await request('POST', '/api/omda/task-sessions', { label, planSha256: 'c'.repeat(64) }, token);
  expect(created.status).toBe(201);
  const sessionId = created.body.session.id as string;
  const started = await request('POST', '/api/omda/task-sessions/' + sessionId + '/transitions', { action: 'start', expectedRevision: 0 }, token);
  expect(started.status).toBe(200);
  return sessionId;
}
async function assign(workerId: string, sessionId: string) {
  return request('POST', '/api/omda/workers/' + workerId + '/assignments', { sessionId });
}

describe('OMDA worker task assignments', () => {
  beforeAll(() => {
    originalEncryptionKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = '2'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashboardToken = mintDashboardToken('worker-assignment-owner@example.com');
  });
  afterAll(() => {
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  it('requires an explicit owner grant before a worker can inspect or claim a session', async () => {
    const worker = await createWorker('assigned-only');
    const sessionId = await createRunningSession('Assignment required');
    const denied = await request('GET', '/api/omda/worker/task-sessions/' + sessionId + '/lease', undefined, worker.workerToken);
    expect(denied.status).toBe(403);
    expect(denied.body.error.type).toBe('worker_assignment_required');
    const granted = await assign(worker.worker.id, sessionId);
    expect(granted.status).toBe(201);
    expect(granted.body.assignment).toMatchObject({ workerId: worker.worker.workerId, sessionId, status: 'active', revision: 1 });
    expect(granted.body.verification).toMatchObject({ valid: true, eventCount: 1 });
    expect(granted.body.created).toBe(true);
    const duplicate = await assign(worker.worker.id, sessionId);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.created).toBe(false);
    expect(duplicate.body.assignment.id).toBe(granted.body.assignment.id);
    const listed = await request('GET', '/api/omda/workers/' + worker.worker.id + '/assignments');
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain('token_hash');
    const claim = await request('POST', '/api/omda/worker/task-sessions/' + sessionId + '/lease/claim', { ttlSeconds: 90 }, worker.workerToken);
    expect(claim.status).toBe(201);
  });

  it('revokes a grant and its active lease atomically', async () => {
    const worker = await createWorker('revocation-worker');
    const sessionId = await createRunningSession('Assignment revocation');
    const granted = await assign(worker.worker.id, sessionId);
    const claim = await request('POST', '/api/omda/worker/task-sessions/' + sessionId + '/lease/claim', {}, worker.workerToken);
    expect(claim.status).toBe(201);
    const revoked = await request('POST', '/api/omda/workers/' + worker.worker.id + '/assignments/' + sessionId + '/revoke', { expectedRevision: 1 });
    expect(revoked.status).toBe(200);
    expect(revoked.body.assignment).toMatchObject({ status: 'revoked', revision: 2 });
    expect(revoked.body.verification).toMatchObject({ valid: true, eventCount: 2 });
    const lease = await request('GET', '/api/omda/task-sessions/' + sessionId + '/lease');
    expect(lease.body.lease).toMatchObject({ status: 'revoked' });
    const blocked = await request('GET', '/api/omda/worker/task-sessions/' + sessionId + '/lease', undefined, worker.workerToken);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.type).toBe('worker_assignment_required');
    const verified = await request('GET', '/api/omda/workers/' + worker.worker.id + '/assignments/' + sessionId + '/verify');
    expect(verified.body).toMatchObject({ valid: true, eventCount: 2 });
    expect(() => downAssignments(getDb())).toThrow(/assignment records or audit history are retained/i);
  });

  it('isolates assignments by worker and dashboard owner', async () => {
    const first = await createWorker('first-worker');
    const second = await createWorker('second-worker');
    const sessionId = await createRunningSession('Assigned to first');
    expect((await assign(first.worker.id, sessionId)).status).toBe(201);
    const otherWorker = await request('GET', '/api/omda/worker/task-sessions/' + sessionId + '/lease', undefined, second.workerToken);
    expect(otherWorker.status).toBe(403);
    expect(otherWorker.body.error.type).toBe('worker_assignment_required');
    const otherUser = createUser('worker-assignment-other@example.com', 'password123');
    const otherToken = createSession(otherUser.userId);
    const otherSession = await createRunningSession('Foreign session', otherToken);
    const hidden = await request('GET', '/api/omda/worker/task-sessions/' + otherSession + '/lease', undefined, first.workerToken);
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.type).toBe('not_found');
  });

  it('revokes assignments when the owner pauses or ends a task session', async () => {
    const worker = await createWorker('lifecycle-worker');
    const sessionId = await createRunningSession('Lifecycle revocation');
    const granted = await assign(worker.worker.id, sessionId);
    const claim = await request('POST', '/api/omda/worker/task-sessions/' + sessionId + '/lease/claim', {}, worker.workerToken);
    expect(claim.status).toBe(201);
    const paused = await request('POST', '/api/omda/task-sessions/' + sessionId + '/transitions', {
      action: 'pause', expectedRevision: 1, note: 'Owner paused the session',
    });
    expect(paused.status).toBe(200);
    const assignment = await request('GET', '/api/omda/workers/' + worker.worker.id + '/assignments/' + sessionId + '/verify');
    expect(assignment.body).toMatchObject({ assignment: { status: 'revoked', revision: 2 }, valid: true });
    const lease = await request('GET', '/api/omda/task-sessions/' + sessionId + '/lease');
    expect(lease.body.lease).toMatchObject({ status: 'revoked' });
    expect(granted.body.assignment.status).toBe('active');
  });

  it('fails closed when the assignment event chain is tampered with', async () => {
    const worker = await createWorker('tamper-assignment');
    const sessionId = await createRunningSession('Assignment tampering');
    const granted = await assign(worker.worker.id, sessionId);
    expect(granted.status).toBe(201);
    getDb().exec('DROP TRIGGER trg_omda_worker_assignment_events_no_update');
    getDb().prepare('UPDATE omda_worker_assignment_events SET event_hash = ? WHERE assignment_id = ? AND seq = 0')
      .run('f'.repeat(64), granted.body.assignment.id);
    const denied = await request('GET', '/api/omda/worker/task-sessions/' + sessionId + '/lease', undefined, worker.workerToken);
    expect(denied.status).toBe(409);
    expect(denied.body.error.type).toBe('worker_assignment_invalid');
    const verification = await request('GET', '/api/omda/workers/' + worker.worker.id + '/assignments/' + sessionId + '/verify');
    expect(verification.body).toMatchObject({ valid: false, reason: 'event_hash_mismatch' });
  });
});
