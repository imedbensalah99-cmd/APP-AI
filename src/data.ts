import { EMPTY_FIELDS, STATUSES, type ApplicationFields, type ApplicationStatus, type JobApplication } from './types';

export const STORAGE_KEY = 'app-ai:job-tracker:v1';

const pick = (value: unknown, max = 4000): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export const isValidDate = (value: string): boolean =>
  value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value);

export function validWebUrl(value: string): string {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

export function sanitizeStatus(value: unknown): ApplicationStatus {
  return STATUSES.includes(value as ApplicationStatus) ? value as ApplicationStatus : 'Wishlist';
}

export function cleanFields(raw: unknown): ApplicationFields | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const company = pick(r.company, 120);
  const role = pick(r.role, 120);
  if (!company || !role) return null;
  const fields: ApplicationFields = {
    ...EMPTY_FIELDS,
    company, role,
    status: sanitizeStatus(r.status),
    location: pick(r.location, 160),
    sourceUrl: validWebUrl(pick(r.sourceUrl, 2048)),
    appliedOn: pick(r.appliedOn, 10),
    deadline: pick(r.deadline, 10),
    followUpOn: pick(r.followUpOn, 10),
    notes: pick(r.notes, 4000),
  };
  for (const key of ['appliedOn', 'deadline', 'followUpOn'] as const) {
    if (!isValidDate(fields[key])) fields[key] = '';
  }
  return fields;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'job-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export function createApplication(fields: ApplicationFields, now = new Date().toISOString()): JobApplication {
  return { ...fields, id: newId(), createdAt: now, updatedAt: now };
}

export function normalizeRecord(value: unknown): JobApplication | null {
  const fields = cleanFields(value);
  if (!fields) return null;
  const r = value as Record<string, unknown>;
  const now = new Date().toISOString();
  return {
    ...fields,
    id: pick(r.id, 160) || newId(),
    createdAt: pick(r.createdAt, 50) || now,
    updatedAt: pick(r.updatedAt, 50) || now,
  };
}

export function readApplications(storage: Pick<Storage, 'getItem'>): JobApplication[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
        !('applications' in value) || !Array.isArray(value.applications)) return [];
    return value.applications.map(normalizeRecord).filter((item): item is JobApplication => item !== null);
  } catch {
    return [];
  }
}

export function saveApplications(storage: Pick<Storage, 'setItem'>, apps: JobApplication[]): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, applications: apps }));
    return true;
  } catch {
    return false;
  }
}

export function todayLocal(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return [year, month, day].join('-');
}

export function isActive(status: ApplicationStatus): boolean {
  return !['Offer', 'Rejected', 'Withdrawn'].includes(status);
}

export function needsAttention(job: JobApplication, today: string): boolean {
  return isActive(job.status) &&
    ((!!job.followUpOn && job.followUpOn <= today) ||
      (job.status === 'Wishlist' && !!job.deadline && job.deadline <= today));
}

export function duplicateKey(job: Pick<JobApplication, 'company' | 'role' | 'appliedOn'>): string {
  return [job.company.toLocaleLowerCase().trim(), job.role.toLocaleLowerCase().trim(), job.appliedOn].join('|');
}
