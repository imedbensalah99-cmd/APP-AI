import type { NextFunction, Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { authenticateOmdaWorker, type OmdaWorkerPrincipal } from '../services/omda-workers.js';

export function requireOmdaWorkerAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(omda_worker_[A-Za-z0-9_-]{43})$/i.exec(header.trim());
  const principal = match ? authenticateOmdaWorker(getDb(), match[1]) : null;
  if (!principal) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({ error: { type: 'worker_authentication_error', message: 'Valid worker credentials are required' } });
    return;
  }
  (req as Request & { omdaWorker?: OmdaWorkerPrincipal }).omdaWorker = principal;
  next();
}
