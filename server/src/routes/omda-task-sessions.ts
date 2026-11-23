import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { TASK_SESSION_ACTIONS, TASK_SESSION_STATUSES, TaskSessionError, type TaskSessionAction, type TaskSessionStatus } from '../lib/omda-task-session-core.js';
import type { SessionUser } from '../services/auth.js';
import {
  createTaskSession,
  getTaskSession,
  listTaskSessions,
  transitionTaskSession,
  verifyTaskSession,
} from '../services/omda-task-sessions.js';

export const omdaTaskSessionsRouter = Router();

const createSchema = z.object({
  label: z.string().trim().min(1).max(120),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

const transitionSchema = z.object({
  action: z.enum(TASK_SESSION_ACTIONS),
  expectedRevision: z.number().int().min(0).max(2_000),
  note: z.string().trim().max(500).optional(),
}).strict();

const statusSchema = z.enum(TASK_SESSION_STATUSES);
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 8 * 1024;

function currentUserId(req: Request): number | null {
  const user = (req as Request & { user?: SessionUser }).user;
  return user && Number.isSafeInteger(user.userId) && user.userId > 0 ? user.userId : null;
}

function bodyWithinLimit(req: Request, res: Response): boolean {
  const bytes = Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8');
  if (bytes <= MAX_BODY_BYTES) return true;
  res.status(413).json({ error: { type: 'payload_too_large', message: 'Request body must not exceed ' + MAX_BODY_BYTES + ' bytes' } });
  return false;
}

function boundedInteger(raw: unknown, fallback: number, min: number, max: number): number | null {
  if (raw === undefined) return fallback;
  const value = String(raw);
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function parseSessionId(req: Request, res: Response): string | null {
  const value = String(req.params.id ?? '');
  if (!SESSION_ID_RE.test(value)) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Invalid task session ID' } });
    return null;
  }
  return value;
}

function fail(res: Response, error: unknown): void {
  if (error instanceof TaskSessionError) {
    res.status(error.status).json({ error: { type: error.code, message: error.message } });
    return;
  }
  res.status(500).json({ error: { type: 'internal_error', message: 'Unable to process task session request' } });
}

omdaTaskSessionsRouter.get('/', (req: Request, res: Response) => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } });
    return;
  }
  const page = boundedInteger(req.query.page, 1, 1, 100_000);
  const pageSize = boundedInteger(req.query.pageSize, 20, 1, 100);
  if (page === null || pageSize === null) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'page must be 1–100000 and pageSize must be 1–100' } });
    return;
  }
  let status: TaskSessionStatus | undefined;
  if (req.query.status !== undefined) {
    const parsedStatus = statusSchema.safeParse(req.query.status);
    if (!parsedStatus.success) {
      res.status(400).json({ error: { type: 'invalid_request', message: 'Invalid task session status' } });
      return;
    }
    status = parsedStatus.data;
  }
  try {
    res.json(listTaskSessions(getDb(), userId, { page, pageSize, status }));
  } catch (error) {
    fail(res, error);
  }
});

omdaTaskSessionsRouter.post('/', (req: Request, res: Response) => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } });
    return;
  }
  if (!bodyWithinLimit(req, res)) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Provide a label and a 64-character SHA-256 plan fingerprint; unknown fields are not accepted' } });
    return;
  }
  try {
    res.status(201).json(createTaskSession(getDb(), userId, parsed.data));
  } catch (error) {
    fail(res, error);
  }
});

omdaTaskSessionsRouter.get('/:id/verify', (req: Request, res: Response) => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } });
    return;
  }
  const id = parseSessionId(req, res);
  if (!id) return;
  try {
    res.json(verifyTaskSession(getDb(), userId, id));
  } catch (error) {
    fail(res, error);
  }
});

omdaTaskSessionsRouter.get('/:id', (req: Request, res: Response) => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } });
    return;
  }
  const id = parseSessionId(req, res);
  if (!id) return;
  try {
    res.json(getTaskSession(getDb(), userId, id));
  } catch (error) {
    fail(res, error);
  }
});

omdaTaskSessionsRouter.post('/:id/transitions', (req: Request, res: Response) => {
  const userId = currentUserId(req);
  if (!userId) {
    res.status(401).json({ error: { type: 'authentication_error', message: 'Authentication required' } });
    return;
  }
  const id = parseSessionId(req, res);
  if (!id) return;
  if (!bodyWithinLimit(req, res)) return;
  const parsed = transitionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'invalid_request', message: 'Provide a valid action and expectedRevision; unknown fields are not accepted' } });
    return;
  }
  try {
    res.json(transitionTaskSession(getDb(), userId, id, {
      action: parsed.data.action as TaskSessionAction,
      expectedRevision: parsed.data.expectedRevision,
      note: parsed.data.note,
    }));
  } catch (error) {
    fail(res, error);
  }
});
