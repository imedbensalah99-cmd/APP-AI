import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { TaskSessionError } from '../lib/omda-task-session-core.js';
import { requireOmdaWorkerAuth } from '../middleware/omdaWorkerAuth.js';
import type { OmdaWorkerPrincipal } from '../services/omda-workers.js';
import {
  claimTaskSessionLease,
  getTaskSessionLease,
  releaseTaskSessionLease,
  renewTaskSessionLease,
} from '../services/omda-task-session-leases.js';

export const omdaWorkerRuntimeRouter = Router();
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const claimSchema = z.object({ ttlSeconds: z.number().int().min(30).max(300).optional() }).strict();
const mutateSchema = z.object({
  leaseId: z.string().uuid(),
  leaseToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expectedRevision: z.number().int().min(1).max(2_000),
  ttlSeconds: z.number().int().min(30).max(300).optional(),
}).strict();

function worker(req: Request): OmdaWorkerPrincipal | null {
  return (req as Request & { omdaWorker?: OmdaWorkerPrincipal }).omdaWorker ?? null;
}

function privateHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

function parseSessionId(req: Request, res: Response): string | null {
  const id = String(req.params.id ?? '');
  if (!SESSION_ID_RE.test(id)) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Invalid task session ID' } });
    return null;
  }
  return id;
}

function bodyWithinLimit(req: Request, res: Response): boolean {
  const bytes = Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8');
  if (bytes <= 2 * 1024) return true;
  res.status(413).json({ error: { type: 'payload_too_large', message: 'Worker runtime request must not exceed 2 KiB' } });
  return false;
}

function fail(res: Response, error: unknown): void {
  if (error instanceof TaskSessionError) {
    res.status(error.status).json({ error: { type: error.code, message: error.message } });
    return;
  }
  res.status(500).json({ error: { type: 'internal_error', message: 'Unable to process worker runtime request' } });
}

omdaWorkerRuntimeRouter.use(privateHeaders);
omdaWorkerRuntimeRouter.use(requireOmdaWorkerAuth);

omdaWorkerRuntimeRouter.get('/me', (req, res) => {
  const principal = worker(req);
  if (!principal) { res.status(401).json({ error: { type: 'worker_authentication_error', message: 'Valid worker credentials are required' } }); return; }
  res.json({
    workerId: principal.workerId,
    label: principal.label,
    registryRevision: principal.revision,
    scopes: ['task_sessions:leases'],
  });
});

omdaWorkerRuntimeRouter.get('/task-sessions/:id/lease', (req, res) => {
  const principal = worker(req);
  const id = parseSessionId(req, res);
  if (!principal || !id) return;
  try { res.json(getTaskSessionLease(getDb(), principal.userId, id)); } catch (error) { fail(res, error); }
});

omdaWorkerRuntimeRouter.post('/task-sessions/:id/lease/claim', (req, res) => {
  const principal = worker(req);
  const id = parseSessionId(req, res);
  if (!principal || !id) return;
  if (!bodyWithinLimit(req, res)) return;
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Provide an optional TTL between 30 and 300 seconds; worker identity is derived from the credential' } });
    return;
  }
  try {
    res.status(201).json(claimTaskSessionLease(getDb(), principal.userId, id, {
      workerId: principal.workerId,
      ttlSeconds: parsed.data.ttlSeconds,
    }));
  } catch (error) { fail(res, error); }
});

omdaWorkerRuntimeRouter.post('/task-sessions/:id/lease/renew', (req, res) => {
  const principal = worker(req);
  const id = parseSessionId(req, res);
  if (!principal || !id) return;
  if (!bodyWithinLimit(req, res)) return;
  const parsed = mutateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Provide leaseId, leaseToken and expectedRevision; unknown fields are rejected' } });
    return;
  }
  try {
    res.json(renewTaskSessionLease(getDb(), principal.userId, id, parsed.data, undefined, principal.workerId));
  } catch (error) { fail(res, error); }
});

omdaWorkerRuntimeRouter.post('/task-sessions/:id/lease/release', (req, res) => {
  const principal = worker(req);
  const id = parseSessionId(req, res);
  if (!principal || !id) return;
  if (!bodyWithinLimit(req, res)) return;
  const parsed = mutateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Provide leaseId, leaseToken and expectedRevision; unknown fields are rejected' } });
    return;
  }
  try {
    res.json(releaseTaskSessionLease(getDb(), principal.userId, id, parsed.data, undefined, principal.workerId));
  } catch (error) { fail(res, error); }
});
