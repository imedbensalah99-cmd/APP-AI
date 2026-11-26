import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { getDb, initDb } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';
import { createUser, createSession } from '../../services/auth.js';
import { claimTaskSessionLease, getTaskSessionLease } from '../../services/omda-task-session-leases.js';

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
    return { status: res.status, body: await res.json().catch(() => null), headers: Object.fromEntries(res.headers.entries()) };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function createRunningSession(label: string) {
  const created = await request('POST', '/api/omda/task-sessions', {
    label, planSha256: 'a'.repeat(64),
  });
  expect(created.status).toBe(201);
  const id = created.body.session.id as string;
  const started = await request('POST', '/api/omda/task-sessions/' + id + '/transitions', {
    action: 'start', expectedRevision: 0,
  });
  expect(started.status).toBe(200);
  return id;
}

describe('OMDA Task Session Worker Leases API', () => {
  beforeAll(() => {
    originalEncryptionKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken('task-leases@example.com');
  });

  afterAll(() => {
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  it('requires dashboard authentication and rejects unknown fields', async () => {
    const id = await createRunningSession('Lease authentication');
    const unauthenticated = await request('GET', '/api/omda/task-sessions/' + id + '/lease', undefined, false);
    expect(unauthenticated.status).toBe(401);
    const invalid = await request('POST', '/api/omda/task-sessions/' + id + '/lease/claim', {
      workerId: 'worker-1', ttlSeconds: 90, command: 'not allowed',
    });
    expect(invalid.status).toBe(400);
  });

  it('claims, renews and releases a lease with one-time token delivery', async () => {
    const id = await createRunningSession('Lease lifecycle');
    const claimed = await request('POST', '/api/omda/task-sessions/' + id + '/lease/claim', {
      workerId: 'worker-01', ttlSeconds: 90,
    });
    expect(claimed.status).toBe(201);
    expect(claimed.body.lease).toMatchObject({ workerId: 'worker-01', status: 'active', revision: 1, expired: false });
    expect(claimed.body.leaseToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(claimed.body.tokenDelivery).toBe('shown_once');
    const token = claimed.body.leaseToken as string;
    const leaseId = claimed.body.lease.leaseId as string;

    const inspected = await request('GET', '/api/omda/task-sessions/' + id + '/lease');
    expect(inspected.status).toBe(200);
    expect(JSON.stringify(inspected.body)).not.toContain(token);
    expect(inspected.body.verification).toMatchObject({ valid: true, eventCount: 1 });

    const competingClaim = await request('POST', '/api/omda/task-sessions/' + id + '/lease/claim', {
      workerId: 'worker-02',
    });
    expect(competingClaim.status).toBe(409);
    expect(competingClaim.body.error.type).toBe('lease_held');

    const renewed = await request('POST', '/api/omda/task-sessions/' + id + '/lease/renew', {
      leaseId, leaseToken: token, expectedRevision: 1, ttlSeconds: 120,
    });
    expect(renewed.status).toBe(200);
    expect(renewed.body.lease).toMatchObject({ status: 'active', revision: 2 });
    expect(renewed.body.ttlSeconds).toBe(120);

    const stale = await request('POST', '/api/omda/task-sessions/' + id + '/lease/renew', {
      leaseId, leaseToken: token, expectedRevision: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.type).toBe('lease_revision_conflict');

    const released = await request('POST', '/api/omda/task-sessions/' + id + '/lease/release', {
      leaseId, leaseToken: token, expectedRevision: 2,
    });
    expect(released.status).toBe(200);
    expect(released.body.lease).toMatchObject({ status: 'released', revision: 3 });
    const verified = await request('GET', '/api/omda/task-sessions/' + id + '/lease/verify');
    expect(verified.body).toMatchObject({ valid: true, eventCount: 3 });
  });

  it('reclaims expired leases and preserves both generations in one event chain', async () => {
    const id = await createRunningSession('Lease expiry');
    const owner = getDb().prepare('SELECT id FROM users WHERE email = ?').get('task-leases@example.com') as { id: number };
    const first = claimTaskSessionLease(getDb(), owner.id, id, { workerId: 'worker-expiry', ttlSeconds: 30 }, new Date('2026-11-26T05:00:00.000Z'));
    const second = claimTaskSessionLease(getDb(), owner.id, id, { workerId: 'worker-replacement', ttlSeconds: 30 }, new Date('2026-11-26T05:00:31.000Z'));
    expect(first.lease.status).toBe('active');
    expect(second.lease.leaseId).not.toBe(first.lease.leaseId);
    expect(second.lease.workerId).toBe('worker-replacement');
    const history = getTaskSessionLease(getDb(), owner.id, id);
    expect(history.verification).toMatchObject({ valid: true, eventCount: 3 });
    expect(history.lease).toMatchObject({ status: 'active', revision: 1 });
  });

  it('revokes a live lease atomically when the task session is paused', async () => {
    const id = await createRunningSession('Lease revocation');
    const claimed = await request('POST', '/api/omda/task-sessions/' + id + '/lease/claim', { workerId: 'worker-pause' });
    expect(claimed.status).toBe(201);
    const token = claimed.body.leaseToken as string;
    const leaseId = claimed.body.lease.leaseId as string;

    const paused = await request('POST', '/api/omda/task-sessions/' + id + '/transitions', {
      action: 'pause', expectedRevision: 1, note: 'Operator paused the session',
    });
    expect(paused.status).toBe(200);
    const inspected = await request('GET', '/api/omda/task-sessions/' + id + '/lease');
    expect(inspected.body.lease).toMatchObject({ status: 'revoked' });
    const renew = await request('POST', '/api/omda/task-sessions/' + id + '/lease/renew', {
      leaseId, leaseToken: token, expectedRevision: 1,
    });
    expect(renew.status).toBe(409);
    expect(renew.body.error.type).toBe('session_not_running');
    const verified = await request('GET', '/api/omda/task-sessions/' + id + '/lease/verify');
    expect(verified.body.valid).toBe(true);
  });

  it('hides another owner’s lease and does not expose token hashes', async () => {
    const id = await createRunningSession('Lease owner isolation');
    const claimed = await request('POST', '/api/omda/task-sessions/' + id + '/lease/claim', { workerId: 'owner-worker' });
    expect(claimed.status).toBe(201);
    const other = createUser('other-lease-owner@example.com', 'password123');
    const previous = dashToken;
    dashToken = createSession(other.userId);
    try {
      const hidden = await request('GET', '/api/omda/task-sessions/' + id + '/lease');
      expect(hidden.status).toBe(404);
      const claim = await request('POST', '/api/omda/task-sessions/' + id + '/lease/claim', { workerId: 'intruder' });
      expect(claim.status).toBe(404);
    } finally {
      dashToken = previous;
    }
    const rows = getDb().prepare('SELECT token_hash FROM omda_task_session_leases WHERE session_id = ?').get(id) as { token_hash: string };
    expect(rows.token_hash).toMatch(/^[a-f0-9]{64}$/);
    const inspected = await request('GET', '/api/omda/task-sessions/' + id + '/lease');
    expect(JSON.stringify(inspected.body)).not.toContain(rows.token_hash);
  });
});
