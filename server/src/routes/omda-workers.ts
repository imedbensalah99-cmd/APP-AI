import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { TaskSessionError } from '../lib/omda-task-session-core.js';
import type { SessionUser } from '../services/auth.js';
import {
  createOmdaWorker,
  listOmdaWorkers,
  revokeOmdaWorker,
  rotateOmdaWorkerToken,
  verifyOmdaWorker,
} from '../services/omda-workers.js';

export const omdaWorkersRouter = Router();
const REGISTRY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const createSchema = z.object({ label: z.string().trim().min(1).max(80) }).strict();
const revisionSchema = z.object({ expectedRevision: z.number().int().min(1).max(1_000) }).strict();

function ownerId(req: Request): number | null {
  const user = (req as Request & { user?: SessionUser }).user;
  return user && Number.isSafeInteger(user.userId) && user.userId > 0 ? user.userId : null;
}

function privateHeaders(_req: Request, res: Response, next: () => void): void {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

function parseRegistryId(req: Request, res: Response): string | null {
  const id = String(req.params.id ?? '');
  if (!REGISTRY_ID_RE.test(id)) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Invalid worker registry ID' } });
    return null;
  }
  return id;
}

function bodyWithinLimit(req: Request, res: Response): boolean {
  const bytes = Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8');
  if (bytes <= 2 * 1024) return true;
  res.status(413).json({ error: { type: 'payload_too_large', message: 'Worker registry request must not exceed 2 KiB' } });
  return false;
}

function fail(res: Response, error: unknown): void {
  if (error instanceof TaskSessionError) {
    res.status(error.status).json({ error: { type: error.code, message: error.message } });
    return;
  }
  res.status(500).json({ error: { type: 'internal_error', message: 'Unable to process worker registry request' } });
}

omdaWorkersRouter.use(privateHeaders);

omdaWorkersRouter.get('/', (req, res) => {
  const owner = ownerId(req);
  if (!owner) { res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } }); return; }
  try { res.json(listOmdaWorkers(getDb(), owner)); } catch (error) { fail(res, error); }
});

omdaWorkersRouter.post('/', (req, res) => {
  const owner = ownerId(req);
  if (!owner) { res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } }); return; }
  if (!bodyWithinLimit(req, res)) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Provide a worker label of 1–80 characters; unknown fields are rejected' } });
    return;
  }
  try { res.status(201).json(createOmdaWorker(getDb(), owner, parsed.data)); } catch (error) { fail(res, error); }
});

omdaWorkersRouter.get('/:id/verify', (req, res) => {
  const owner = ownerId(req);
  if (!owner) { res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } }); return; }
  const id = parseRegistryId(req, res);
  if (!id) return;
  try { res.json(verifyOmdaWorker(getDb(), owner, id)); } catch (error) { fail(res, error); }
});

omdaWorkersRouter.post('/:id/rotate', (req, res) => {
  const owner = ownerId(req);
  if (!owner) { res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } }); return; }
  const id = parseRegistryId(req, res);
  if (!id) return;
  if (!bodyWithinLimit(req, res)) return;
  const parsed = revisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Provide expectedRevision; unknown fields are rejected' } });
    return;
  }
  try { res.json(rotateOmdaWorkerToken(getDb(), owner, id, parsed.data.expectedRevision)); } catch (error) { fail(res, error); }
});

omdaWorkersRouter.post('/:id/revoke', (req, res) => {
  const owner = ownerId(req);
  if (!owner) { res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } }); return; }
  const id = parseRegistryId(req, res);
  if (!id) return;
  if (!bodyWithinLimit(req, res)) return;
  const parsed = revisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Provide expectedRevision; unknown fields are rejected' } });
    return;
  }
  try { res.json(revokeOmdaWorker(getDb(), owner, id, parsed.data.expectedRevision)); } catch (error) { fail(res, error); }
});
