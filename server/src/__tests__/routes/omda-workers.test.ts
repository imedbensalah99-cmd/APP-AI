import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { getDb, initDb } from '../../db/index.js';
import { down as downWorkerRegistry } from '../../db/migrations/20261127_000001_omda_worker_registry.js';
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
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      body: await response.json().catch(() => null),
      headers: Object.fromEntries(response.headers.entries()),
    };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function createRunningSession(label: string, token = dashboardToken): Promise<string> {
  const created = await request('POST', '/api/omda/task-sessions', {
    label,
    planSha256: 'b'.repeat(64),
  }, token);
  expect(created.status).toBe(201);
  const id = created.body.session.id as string;
  const started = await request('POST', '/api/omda/task-sessions/' + id + '/transitions', {
    action: 'start',
    expectedRevision: 0,
  }, token);
  expect(started.status).toBe(200);
  return id;
}

async function assignWorkerToSession(workerRegistryId: string, sessionId: string) {
  const response = await request('POST', '/api/omda/workers/' + workerRegistryId + '/assignments', { sessionId });
  expect(response.status).toBe(201);
  return response.body;
}

async function createWorker(label: string, token = dashboardToken) {
  const response = await request('POST', '/api/omda/workers', { label }, token);
  expect(response.status).toBe(201);
  return response.body as {
    worker: { id: string; workerId: string; label: string; revision: number; status: string };
    workerToken: string;
    tokenDelivery: string;
  };
}

describe('OMDA authenticated worker registry and runtime', () => {
  beforeAll(() => {
    originalEncryptionKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = '1'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashboardToken = mintDashboardToken('worker-admin@example.com');
  });

  afterAll(() => {
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  it('requires dashboard auth for registry operations and returns a token only once', async () => {
    const unauthenticated = await request('GET', '/api/omda/workers', undefined, null);
    expect(unauthenticated.status).toBe(401);

    const created = await createWorker('staging-worker');
    expect(created.workerToken).toMatch(/^omda_worker_[A-Za-z0-9_-]{43}$/);
    expect(created.tokenDelivery).toBe('shown_once');
    expect(created.worker).toMatchObject({
      label: 'staging-worker',
      status: 'active',
      revision: 1,
      scope: ['task_sessions:leases:assigned'],
    });

    const listed = await request('GET', '/api/omda/workers');
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(created.workerToken);
    expect(JSON.stringify(listed.body)).not.toContain('token_hash');
    expect(listed.body.items[0].verification).toMatchObject({ valid: true, eventCount: 1 });

    const rawHash = getDb().prepare('SELECT token_hash FROM omda_workers WHERE id = ?')
      .get(created.worker.id) as { token_hash: string };
    expect(rawHash.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rawHash.token_hash).not.toBe(created.workerToken);

    const dashboardTokenRejectedByWorkerApi = await request('GET', '/api/omda/worker/me');
    expect(dashboardTokenRejectedByWorkerApi.status).toBe(401);
    expect(dashboardTokenRejectedByWorkerApi.headers['cache-control']).toContain('no-store');
  });

  it('derives lease identity from the credential and binds renew/release to that worker', async () => {
    const first = await createWorker('worker-alpha');
    const second = await createWorker('worker-beta');
    const sessionId = await createRunningSession('Worker authenticated lease');
    await assignWorkerToSession(first.worker.id, sessionId);
    await assignWorkerToSession(second.worker.id, sessionId);

    const claimed = await request(
      'POST',
      '/api/omda/worker/task-sessions/' + sessionId + '/lease/claim',
      { ttlSeconds: 90 },
      first.workerToken,
    );
    expect(claimed.status).toBe(201);
    expect(claimed.body.lease.workerId).toBe(first.worker.workerId);
    expect(claimed.body.leaseToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const me = await request('GET', '/api/omda/worker/me', undefined, first.workerToken);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      workerId: first.worker.workerId,
      label: 'worker-alpha',
      scopes: ['task_sessions:leases:assigned'],
    });

    const spoofedIdentity = await request(
      'POST',
      '/api/omda/worker/task-sessions/' + sessionId + '/lease/claim',
      { workerId: 'operator-chosen-id' },
      first.workerToken,
    );
    expect(spoofedIdentity.status).toBe(400);

    const mutation = {
      leaseId: claimed.body.lease.leaseId,
      leaseToken: claimed.body.leaseToken,
      expectedRevision: 1,
    };
    const otherWorker = await request(
      'POST',
      '/api/omda/worker/task-sessions/' + sessionId + '/lease/renew',
      mutation,
      second.workerToken,
    );
    expect(otherWorker.status).toBe(403);
    expect(otherWorker.body.error.type).toBe('lease_worker_mismatch');

    const renewed = await request(
      'POST',
      '/api/omda/worker/task-sessions/' + sessionId + '/lease/renew',
      { ...mutation, expectedRevision: 1, ttlSeconds: 120 },
      first.workerToken,
    );
    expect(renewed.status).toBe(200);
    expect(renewed.body.lease).toMatchObject({ workerId: first.worker.workerId, revision: 2 });

    const released = await request(
      'POST',
      '/api/omda/worker/task-sessions/' + sessionId + '/lease/release',
      { ...mutation, expectedRevision: 2 },
      first.workerToken,
    );
    expect(released.status).toBe(200);
    expect(released.body.lease.status).toBe('released');
  });

  it('rotates and revokes credentials immediately with revision-protected audit history', async () => {
    const created = await createWorker('rotation-worker');
    const rotated = await request('POST', '/api/omda/workers/' + created.worker.id + '/rotate', {
      expectedRevision: 1,
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.workerToken).not.toBe(created.workerToken);
    expect(rotated.body.worker.revision).toBe(2);

    const oldToken = await request('GET', '/api/omda/worker/me', undefined, created.workerToken);
    expect(oldToken.status).toBe(401);
    const newToken = rotated.body.workerToken as string;
    expect((await request('GET', '/api/omda/worker/me', undefined, newToken)).status).toBe(200);

    const staleRevoke = await request('POST', '/api/omda/workers/' + created.worker.id + '/revoke', {
      expectedRevision: 1,
    });
    expect(staleRevoke.status).toBe(409);
    expect(staleRevoke.body.error.type).toBe('worker_revision_conflict');

    const revoked = await request('POST', '/api/omda/workers/' + created.worker.id + '/revoke', {
      expectedRevision: 2,
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body.worker).toMatchObject({ status: 'revoked', revision: 3 });

    const revokedToken = await request('GET', '/api/omda/worker/me', undefined, newToken);
    expect(revokedToken.status).toBe(401);
    const verification = await request('GET', '/api/omda/workers/' + created.worker.id + '/verify');
    expect(verification.body).toMatchObject({ valid: true, eventCount: 3 });
  });

  it('does not let a worker access another dashboard owner’s task session', async () => {
    const worker = await createWorker('owner-one-worker');
    const otherUser = createUser('worker-owner-two@example.com', 'password123');
    const otherToken = createSession(otherUser.userId);
    const otherSessionId = await createRunningSession('Other owner task', otherToken);

    const claim = await request(
      'POST',
      '/api/omda/worker/task-sessions/' + otherSessionId + '/lease/claim',
      {},
      worker.workerToken,
    );
    expect(claim.status).toBe(404);
    expect(claim.body.error.type).toBe('not_found');
  });

  it('fails closed when the append-only worker audit chain is tampered with', async () => {
    const worker = await createWorker('tamper-worker');
    getDb().exec('DROP TRIGGER trg_omda_worker_events_no_update');
    getDb().prepare('UPDATE omda_worker_events SET credential_hash = ? WHERE registry_id = ? AND seq = 0')
      .run('f'.repeat(64), worker.worker.id);

    const runtime = await request('GET', '/api/omda/worker/me', undefined, worker.workerToken);
    expect(runtime.status).toBe(401);

    const verification = await request('GET', '/api/omda/workers/' + worker.worker.id + '/verify');
    expect(verification.body).toMatchObject({ valid: false, reason: 'event_hash_mismatch' });
  });

  it('caps active workers and refuses rollback while credentials are retained', async () => {
    const owner = createUser('worker-limit@example.com', 'password123');
    const { createOmdaWorker } = await import('../../services/omda-workers.js');
    for (let index = 0; index < 10; index += 1) {
      createOmdaWorker(getDb(), owner.userId, { label: 'bounded-' + index });
    }
    expect(() => createOmdaWorker(getDb(), owner.userId, { label: 'overflow' }))
      .toThrow(/at most 10 active workers/i);
    expect(() => downWorkerRegistry(getDb())).toThrow(/credentials or audit history are retained/i);
  });
  it('bounds retained registry records even after credentials are revoked', async () => {
    const owner = createUser('worker-record-cap@example.com', 'password123');
    const { createOmdaWorker, revokeOmdaWorker } = await import('../../services/omda-workers.js');
    for (let index = 0; index < 50; index += 1) {
      const created = createOmdaWorker(getDb(), owner.userId, { label: 'retained-' + index });
      revokeOmdaWorker(getDb(), owner.userId, created.worker.id, 1);
    }
    expect(() => createOmdaWorker(getDb(), owner.userId, { label: 'beyond-retention-cap' }))
      .toThrow(/50 worker registry records/i);
  });

  it('keeps worker identity fields immutable and binds them into the audit chain', async () => {
    const worker = await createWorker('immutable-worker');
    expect(() => getDb().prepare('UPDATE omda_workers SET label = ? WHERE id = ?')
      .run('renamed-without-audit', worker.worker.id)).toThrow(/identity fields are immutable/i);
    expect(() => getDb().prepare('UPDATE omda_workers SET worker_id = ? WHERE id = ?')
      .run('wrk_forgedidentity', worker.worker.id)).toThrow(/identity fields are immutable/i);
    const verification = await request('GET', '/api/omda/workers/' + worker.worker.id + '/verify');
    expect(verification.body).toMatchObject({ valid: true, eventCount: 1 });
  });

  it('fails closed when the active credential fingerprint is changed in storage', async () => {
    const worker = await createWorker('credential-fingerprint-worker');
    getDb().prepare('UPDATE omda_workers SET token_hash = ? WHERE id = ?')
      .run('f'.repeat(64), worker.worker.id);
    const runtime = await request('GET', '/api/omda/worker/me', undefined, worker.workerToken);
    expect(runtime.status).toBe(401);
    const verification = await request('GET', '/api/omda/workers/' + worker.worker.id + '/verify');
    expect(verification.body).toMatchObject({ valid: false, reason: 'credential_fingerprint_mismatch' });
  });

});
