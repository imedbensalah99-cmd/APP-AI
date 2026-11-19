// OMDA AI Company: server-side fail-closed guard for its ONE staging client profile.
// This is intentionally separate from the public/legacy client profiles and
// does not enable inference or provision credentials.
import type { Request, Response, NextFunction } from 'express';
import type { RouteResult } from '../services/router.js';
import { getDb } from '../db/index.js';
import { resolveAuth } from './system-prompt.js';
import { inspectOmdaAgentPayload, OMDA_AGENT_POLICY } from './omda-agent-policy.js';

export const OMDA_AGENT_PROFILE = 'OMDA-Agent-Staging';
export const OMDA_AGENT_MODEL = OMDA_AGENT_POLICY.model;
const DAILY_LIMIT = 10;
const MINUTE_LIMIT = 1;

function credential(req: Request): string {
  const bearer = req.get('authorization') || '';
  const fromBearer = /^Bearer\s+(sk-cp-[a-f0-9]{48})$/i.exec(bearer);
  if (fromBearer) return fromBearer[1]!;
  const alt = req.get('x-api-key') || req.get('x-goog-api-key') || '';
  return /^sk-cp-[a-f0-9]{48}$/i.test(alt) ? alt : '';
}

export function isOmdaAgentAuth(auth: { kind: string; name?: string } | null): boolean {
  return auth?.kind === 'profile' && auth.name === OMDA_AGENT_PROFILE;
}

export function validOmdaAgentRequest(method: string, originalPath: string, body: unknown): boolean {
  return method === 'POST' &&
    originalPath === '/v1/chat/completions' &&
    inspectOmdaAgentPayload(body).allowed;
}

export function omdaProviderAllowed(route: Pick<RouteResult,'platform'|'modelId'>): boolean {
  return route.platform==='groq' && route.modelId===OMDA_AGENT_MODEL;
}

// Separate server-side limiter; the Cloudflare bridge independently enforces
// the same policy. The SQLite DB is persisted by the encrypted backup system.
function reserveOmdaServerQuota(profileId: number): boolean {
  const db=getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS omda_agent_server_quotas (
    profile_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    minute TEXT NOT NULL,
    daily_count INTEGER NOT NULL CHECK(daily_count BETWEEN 0 AND 10),
    minute_count INTEGER NOT NULL CHECK(minute_count BETWEEN 0 AND 1),
    PRIMARY KEY(profile_id, day)
  )`);
  const at=new Date().toISOString();
  const day=at.slice(0,10), minute=at.slice(0,16);
  const value=db.prepare(`INSERT INTO omda_agent_server_quotas(profile_id,day,minute,daily_count,minute_count)
    VALUES(?,?,?,1,1)
    ON CONFLICT(profile_id,day) DO UPDATE SET
      minute=excluded.minute,
      daily_count=omda_agent_server_quotas.daily_count+1,
      minute_count=CASE WHEN omda_agent_server_quotas.minute=excluded.minute THEN omda_agent_server_quotas.minute_count+1 ELSE 1 END
    WHERE omda_agent_server_quotas.daily_count < ? AND
      (omda_agent_server_quotas.minute <> excluded.minute OR omda_agent_server_quotas.minute_count < ?)
    RETURNING daily_count`).get(profileId,day,minute,DAILY_LIMIT,MINUTE_LIMIT);
  return !!value;
}

export function omdaAgentProfileGate(req:Request,res:Response,next:NextFunction):void {
  const token=credential(req);
  if (!token) { next(); return; }
  const auth=resolveAuth(token);
  if(!isOmdaAgentAuth(auth)){ next();return; }
  // An operator's accidental UI toggle cannot enable inference before the
  // separately reviewed provider/bridge setup. OFF unless explicitly set.
  if(process.env.OMDA_AGENT_INFERENCE_ALLOWED!=='true'){
    res.status(403).json({error:{type:'omda_agent_disabled',message:'OMDA Agent inference is not enabled on this server.'}});
    return;
  }
  const path=req.originalUrl.split('?')[0]!;
  if(!validOmdaAgentRequest(req.method,path,req.body)){
    res.setHeader('Cache-Control','no-store');
    res.status(403).json({error:{type:'omda_agent_policy',message:'OMDA profile is restricted to bounded Groq text-only chat.'}});
    return;
  }
  try {
    if(!reserveOmdaServerQuota((auth as {profileId:number}).profileId)){
      res.setHeader('Cache-Control','no-store');
      res.status(429).json({error:{type:'omda_agent_quota',message:'OMDA Agent staging daily or minute limit reached.'}});
      return;
    }
  }catch{
    res.status(503).json({error:{type:'omda_agent_policy',message:'OMDA quota storage unavailable.'}});
    return;
  }
  next();
}
