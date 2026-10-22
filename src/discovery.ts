import { analyzeJob, sameJob, type AgentJob } from './agent';
import { validWebUrl } from './data';
import type { JobApplication } from './types';

export interface DiscoveredJob extends AgentJob {
  id: string;
  source: string;
  published: string;
  remote: boolean;
  eligibility: string;
  sourceChecked: boolean;
}

export interface ReviewDraft {
  id: string;
  job: DiscoveredJob;
  body: string;
  recipient: string;
  status: 'Draft' | 'Handoff' | 'Sent-confirmed';
  preparedAt: string;
}

const RELEVANT = /\b(aml|kyc|compliance|fraud|risk|financial crime|operations|administration|admin|finance|accounting|analyst|document control|data entry|customer support|customer service|recruitment|hr assistant|banking|sanctions|transaction monitoring)\b/i;
const TOO_SENIOR = /\b(senior|sr\.?|head|director|chief|principal|lead|manager|mlro|dmlro|vp|vice president)\b/i;
const ONLY_QATARI = /qatari nationals? only|qataris only|qatarization only|qatari citizens? only/i;
const TOO_OLD_DAYS = 65;

export function normalizeHimalayas(data: unknown, now = Date.now()): DiscoveredJob[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { jobs?: unknown }).jobs)) {
    throw new Error('Jobs source returned an unexpected response.');
  }
  const result: DiscoveredJob[] = [];
  const known = new Set<string>();
  for (const raw of (data as { jobs: unknown[] }).jobs) {
    if (!raw || typeof raw !== 'object') continue;
    const j = raw as Record<string, unknown>;
    const company = typeof j.companyName === 'string' ? j.companyName.trim() : '';
    const role = typeof j.title === 'string' ? j.title.trim() : '';
    const sourceUrl = validWebUrl(typeof j.applicationLink === 'string' ? j.applicationLink : '');
    const guid = typeof j.guid === 'string' ? j.guid : sourceUrl;
    if (!company || !role || !sourceUrl || !guid || !RELEVANT.test(role) || TOO_SENIOR.test(role)) continue;
    const timestamp = typeof j.pubDate === 'number' ? j.pubDate : 0;
    if (timestamp && now - timestamp * 1000 > TOO_OLD_DAYS * 86400000) continue;
    const expiry = typeof j.expiryDate === 'number' ? j.expiryDate : 0;
    if (expiry && now >= expiry * 1000) continue;
    const countries = Array.isArray(j.locationRestrictions) ? j.locationRestrictions as unknown[] : [];
    const restricted = countries.length > 0 && !countries.some(c => {
      if (typeof c === 'string') return /^(qa|qatar|worldwide)$/i.test(c);
      if (c && typeof c === 'object') {
        const country = c as Record<string, unknown>;
        const alpha = String(country.alpha2 ?? '').toUpperCase();
        const name = String(country.name ?? '').toLowerCase();
        return alpha === 'QA' || name === 'qatar';
      }
      return false;
    });
    // Avoid false eligibility when a listing names a non-Qatar country only.
    if (restricted) continue;
    const plain = String(j.description ?? j.excerpt ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').slice(0, 5000);
    if (ONLY_QATARI.test(plain)) continue;
    const id = 'himalayas:' + guid;
    if (known.has(id)) continue;
    known.add(id);
    result.push({
      id, company: company.slice(0, 120), role: role.slice(0, 120),
      location: countries.length ? 'Remote · Qatar eligible (location filter)' : 'Remote · worldwide listing',
      sourceUrl, description: plain, source: 'Himalayas',
      published: timestamp ? new Date(timestamp * 1000).toISOString().slice(0, 10) : '',
      remote: true, sourceChecked: true,
      eligibility: 'Country filtering only; confirm employer screening requirements yourself.',
    });
  }
  return result;
}

export function parseImportedJobs(input: string): DiscoveredJob[] {
  if (input.length > 150000) throw new Error('Import exceeds the 150 KB limit.');
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw new Error('Paste a valid JSON list of job leads.'); }
  if (!Array.isArray(value) || value.length > 50) throw new Error('Import 1–50 job objects in a JSON array.');
  const result: DiscoveredJob[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const company = String(obj.company ?? '').trim().slice(0, 120);
    const role = String(obj.role ?? obj.title ?? '').trim().slice(0, 120);
    const sourceUrl = validWebUrl(String(obj.sourceUrl ?? obj.url ?? ''));
    if (!company || !role || !sourceUrl) continue;
    result.push({
      id: 'import:' + sourceUrl, company, role,
      sourceUrl, location: String(obj.location ?? 'Qatar').slice(0, 160),
      description: String(obj.description ?? '').slice(0, 5000),
      published: '', source: 'Imported research — verify independently',
      remote: false, sourceChecked: false,
      eligibility: 'Unverified. Open the employer site and check the vacancy is live.',
    });
    if (index >= 49) break;
  }
  return result;
}

export function uniqueLeads(items: DiscoveredJob[], existing: JobApplication[] = []): DiscoveredJob[] {
  const output: DiscoveredJob[] = [];
  for (const job of items) {
    if (output.some(old => old.id === job.id || sameJob(job, old))) continue;
    if (existing.some(app => sameJob(job, app) || (!!job.sourceUrl && job.sourceUrl === app.sourceUrl))) continue;
    output.push(job);
  }
  return output;
}

export function rankLead(job: DiscoveredJob, facts: string, existing: JobApplication[]) {
  const result = analyzeJob(job, facts, existing);
  return { ...result, score: result.matching.length, scoreLabel: result.matching.length + ' CV skill matches' };
}

export async function searchJobFeeds(fetcher: typeof fetch, keyword: string): Promise<DiscoveredJob[]> {
  const searchUrl = new URL('https://himalayas.app/jobs/api/search');
  searchUrl.searchParams.set('country', 'QA');
  searchUrl.searchParams.set('sort', 'recent');
  searchUrl.searchParams.set('q', keyword);
  const response = await fetcher(searchUrl.toString(), { mode: 'cors', credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 429 ? 'Free job source rate limit; try again later.' : 'Job source returned HTTP ' + response.status);
  const json: unknown = await response.json();
  return normalizeHimalayas(json);
}
