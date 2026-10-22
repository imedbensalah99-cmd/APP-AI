import { analyzeJob, generateDraft, type AgentJob } from './agent';
import { validWebUrl } from './data';
import type { JobApplication } from './types';

export interface DiscoveredJob extends AgentJob {
  id: string;
  source: string;
  postedAt: string;
  kind: 'qatar-lead' | 'remote';
  verification: 'board-listing' | 'unverified-lead';
}

export interface JobFeed {
  generatedAt: string;
  jobs: DiscoveredJob[];
  errors: string[];
}

export type DraftState = 'ready' | 'handoff' | 'trashed' | 'reported-sent';

export interface ApplicationDraft {
  id: string;
  job: DiscoveredJob;
  body: string;
  email: string;
  state: DraftState;
  updatedAt: string;
}

const pick = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export function normalizeJob(raw: unknown): DiscoveredJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  const id = pick(j.id, 260);
  const company = pick(j.company, 120);
  const role = pick(j.role, 120);
  const sourceUrl = validWebUrl(pick(j.sourceUrl, 2048));
  if (!id || !company || !role || !sourceUrl) return null;
  return {
    id, company, role, sourceUrl, location: pick(j.location, 160),
    description: pick(j.description, 7500), source: pick(j.source, 80),
    postedAt: pick(j.postedAt, 60),
    kind: j.kind === 'remote' ? 'remote' : 'qatar-lead',
    verification: j.verification === 'board-listing' ? 'board-listing' : 'unverified-lead',
  };
}

export function normalizeFeed(value: unknown): JobFeed {
  if (!value || typeof value !== 'object') throw new Error('Job feed is unavailable.');
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.jobs) || typeof raw.generatedAt !== 'string') {
    throw new Error('Job feed is not in the expected format.');
  }
  const seen = new Set<string>();
  const jobs: DiscoveredJob[] = [];
  for (const item of raw.jobs.slice(0, 400)) {
    const job = normalizeJob(item);
    if (!job || seen.has(job.id)) continue;
    seen.add(job.id);
    jobs.push(job);
  }
  return {
    generatedAt: pick(raw.generatedAt, 60),
    jobs,
    errors: Array.isArray(raw.errors) ? raw.errors.filter((s): s is string => typeof s === 'string').slice(0, 10) : [],
  };
}

export function makeDraft(job: DiscoveredJob, facts: string, name: string): ApplicationDraft {
  const generated = generateDraft(job, facts, name);
  return {
    id: job.id,
    job,
    body: generated,
    email: '',
    state: 'ready',
    updatedAt: new Date().toISOString(),
  };
}

export function jobAssessment(job: DiscoveredJob, facts: string, apps: JobApplication[]) {
  return analyzeJob(job, facts, apps);
}

export function isDraftState(value: unknown): value is DraftState {
  return value === 'ready' || value === 'handoff' || value === 'trashed' || value === 'reported-sent';
}

export function loadDrafts(storage: Pick<Storage, 'getItem'>, key: string): ApplicationDraft[] {
  try {
    const data: unknown = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(data)) return [];
    return data.slice(0, 200).flatMap((item): ApplicationDraft[] => {
      if (!item || typeof item !== 'object') return [];
      const raw = item as Record<string, unknown>;
      const job = normalizeJob(raw.job);
      if (!job || !isDraftState(raw.state)) return [];
      return [{
        id: job.id, job, body: pick(raw.body, 11000),
        email: pick(raw.email, 254), state: raw.state, updatedAt: pick(raw.updatedAt, 60),
      }];
    });
  } catch { return []; }
}
