import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { TaskSessionError } from '../lib/omda-task-session-core.js';
import type { SessionUser } from '../services/auth.js';
import {
  claimTaskSessionLease,
  getTaskSessionLease,
  releaseTaskSessionLease,
  renewTaskSessionLease,
  verifyTaskSessionLease,
} from '../services/omda-task-session-leases.js';

export const omdaTaskSessionLeasesRouter = Router();
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 2 * 1024;

const claimSchema = z.object({
  workerId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/),
  ttlSeconds: z.number().int().min(30).max(300).optional(),
}).strict();

const mutateSchema = z.object({
  leaseId: z.string().uuid(),
  leaseToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expectedRevision: z.number().int().min(1).max(2_000),
  ttlSeconds: z.number().int().min(30).max(300).optional(),
}).strict();

function userId(req: Request): number | null {
  const user = (req as Request & { user?: SessionUser }).user;
  return user && Number.isSafeInteger(user.userId) && user.userId > 0 ? user.userId : null;
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
  if (bytes <= MAX_BODY_BYTES) return true;
  res.status(413).json({ error: { type: 'payload_too_large', message: 'Lease request must not exceed 2 KiB' } });
  return false;
}

function privateHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function fail(res: Response, error: unknown): void {
  if (error instanceof TaskSessionError) {
    res.status(error.status).json({ error: { type: error.code, message: error.message } });
    return;
  }
  res.status(500).json({ error: { type: 'internal_error', message: 'Unable to process task session lease request' } });
}

omdaTaskSessionLeasesRouter.use((_req, res, next) => {
  privateHeaders(res);
  next();
});

omdaTaskSessionLeasesRouter.get('/:id/lease/verify', (req, res) => {
  const owner = userId(req);
  if (!owner) { res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } }); return; }
  const id = parseSessionId(req, res);
  if (!id) return;
  try { res.json(verifyTaskSessionLease(getDb(), owner, id)); } catch (error) { fail(res, error); }
});

omdaTaskSessionLeasesRouter.get('/:id/lease', (req, res) => {
  const owner = userId(req);
  if (!owner) { res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } }); return; }
  const id = parseSessionId(req, res);
  if (!id) return;
  try { res.json(getTaskSessionLease(getDb(), owner, id)); } catch (error) { fail(res, error); }
});

omdaTaskSessionLeasesRouter.post('/:id/lease/claim', (req, res) => {
  const owner = userId(req);
  if (!owner) { res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } }); return; }
  const id = parseSessionId(req, res);
  if (!id) return;
  if (!bodyWithinLimit(req, res)) return;
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Provide a valid workerId and optional TTL between 30 and 300 seconds; unknown fields are rejected' } });
    return;
  }
  try { res.status(201).json(claimTaskSessionLease(getDb(), owner, id, parsed.data)); } catch (error) { fail(res, error); }
});

omdaTaskSessionLeasesRouter.post('/:id/lease/renew', (req, res) => {
  const owner = userId(req);
  if (!owner) { res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } }); return; }
  const id = parseSessionId(req, res);
  if (!id) return;
  if (!bodyWithinLimit(req, res)) return;
  const parsed = mutateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Provide leaseId, leaseToken, expectedRevision and optional TTL; unknown fields are rejected' } });
    return;
  }
  try { res.json(renewTaskSessionLease(getDb(), owner, id, parsed.data)); } catch (error) { fail(res, error); }
});

omdaTaskSessionLeasesRouter.post('/:id/lease/release', (req, res) => {
  const owner = userId(req);
  if (!owner) { res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } }); return; }
  const id = parseSessionId(req, res);
  if (!id) return;
  if (!bodyWithinLimit(req, res)) return;
  const parsed = mutateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Provide leaseId, leaseToken and expectedRevision; unknown fields are rejected' } });
    return;
  }
  try { res.json(releaseTaskSessionLease(getDb(), owner, id, parsed.data)); } catch (error) { fail(res, error); }
});
