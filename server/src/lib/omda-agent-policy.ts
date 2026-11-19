import type { Db } from '../db/types.js';

export const OMDA_AGENT_POLICY = Object.freeze({
  version: 1,
  profile: 'OMDA-Agent-Staging',
  model: 'openai/gpt-oss-20b',
  endpoint: 'POST /v1/chat/completions',
  provider: 'groq',
  maxTokens: 128,
  temperature: 0.2,
  stream: false,
  messageCount: 2,
  systemMaxChars: 220,
  userMaxChars: 1000,
  dailyLimit: 10,
  perMinuteLimit: 1,
  mediaAllowed: false,
  toolsAllowed: false,
});

const EXPECTED_KEYS = ['max_tokens', 'messages', 'model', 'stream', 'temperature'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function messageIsValid(value: unknown, role: 'system' | 'user', maxChars: number): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (Object.keys(value).sort().join('|') !== 'content|role') return false;
  return value.role === role &&
    typeof value.content === 'string' &&
    value.content.length > 0 &&
    value.content.length <= maxChars;
}

export interface OmdaAgentPayloadInspection {
  allowed: boolean;
  reasonCodes: string[];
  metadata: {
    messageCount: number;
    totalChars: number;
    maxTokens: number | null;
    temperature: number | null;
    streaming: boolean | null;
    mediaAllowed: false;
    toolsAllowed: false;
  };
}

/**
 * Inspect the exact staging request contract without returning or persisting
 * prompt text. This is shared by the operator preflight API and the inference
 * guard so the two checks cannot silently drift apart.
 */
export function inspectOmdaAgentPayload(body: unknown): OmdaAgentPayloadInspection {
  const codes = new Set<string>();
  if (!isRecord(body)) {
    return {
      allowed: false,
      reasonCodes: ['body_not_object'],
      metadata: {
        messageCount: 0,
        totalChars: 0,
        maxTokens: null,
        temperature: null,
        streaming: null,
        mediaAllowed: false,
        toolsAllowed: false,
      },
    };
  }

  if (Object.keys(body).sort().join('|') !== EXPECTED_KEYS.join('|')) {
    codes.add('fields_must_match_exactly');
  }
  if (body.model !== OMDA_AGENT_POLICY.model) codes.add('model_not_allowed');
  if (body.max_tokens !== OMDA_AGENT_POLICY.maxTokens) codes.add('max_tokens_must_equal_128');
  if (body.temperature !== OMDA_AGENT_POLICY.temperature) codes.add('temperature_must_equal_0_2');
  if (body.stream !== false) codes.add('streaming_not_allowed');

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!Array.isArray(body.messages) || messages.length !== OMDA_AGENT_POLICY.messageCount) {
    codes.add('messages_must_be_system_then_user');
  } else {
    if (!messageIsValid(messages[0], 'system', OMDA_AGENT_POLICY.systemMaxChars)) {
      codes.add('system_message_invalid');
    }
    if (!messageIsValid(messages[1], 'user', OMDA_AGENT_POLICY.userMaxChars)) {
      codes.add('user_message_invalid');
    }
  }

  const totalChars = messages.reduce((sum, message) => {
    if (!isRecord(message) || typeof message.content !== 'string') return sum;
    return sum + message.content.length;
  }, 0);

  return {
    allowed: codes.size === 0,
    reasonCodes: [...codes],
    metadata: {
      messageCount: messages.length,
      totalChars,
      maxTokens: typeof body.max_tokens === 'number' ? body.max_tokens : null,
      temperature: typeof body.temperature === 'number' ? body.temperature : null,
      streaming: typeof body.stream === 'boolean' ? body.stream : null,
      mediaAllowed: false,
      toolsAllowed: false,
    },
  };
}

export interface OmdaAgentQuotaStatus {
  initialized: boolean;
  scope: 'not_initialized' | 'max_per_profile';
  limits: { daily: number; perMinute: number };
  usage: { daily: number; perMinute: number; observedProfiles: number };
  remaining: { daily: number; perMinute: number };
  resetsAt: { daily: string; perMinute: string };
}

/**
 * Read the existing SQLite quota table without creating it or writing rows.
 * The table is keyed by profile/day; MAX reports the tightest single-profile
 * usage while observedProfiles makes unexpected duplicate profiles visible.
 */
export function readOmdaAgentQuotaStatus(db: Db, now = new Date()): OmdaAgentQuotaStatus {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('A valid Date is required');
  }

  const day = now.toISOString().slice(0, 10);
  const minute = now.toISOString().slice(0, 16);
  const dailyReset = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  )).toISOString();
  const minuteReset = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes() + 1,
  )).toISOString();

  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get('omda_agent_server_quotas') as { name?: string } | undefined;

  if (!table?.name) {
    return {
      initialized: false,
      scope: 'not_initialized',
      limits: { daily: OMDA_AGENT_POLICY.dailyLimit, perMinute: OMDA_AGENT_POLICY.perMinuteLimit },
      usage: { daily: 0, perMinute: 0, observedProfiles: 0 },
      remaining: { daily: OMDA_AGENT_POLICY.dailyLimit, perMinute: OMDA_AGENT_POLICY.perMinuteLimit },
      resetsAt: { daily: dailyReset, perMinute: minuteReset },
    };
  }

  const row = db.prepare(`
    SELECT
      COUNT(*) AS observed_profiles,
      COALESCE(MAX(daily_count), 0) AS daily_used,
      COALESCE(MAX(CASE WHEN minute = ? THEN minute_count ELSE 0 END), 0) AS minute_used
    FROM omda_agent_server_quotas
    WHERE day = ?
  `).get(minute, day) as {
    observed_profiles?: number;
    daily_used?: number;
    minute_used?: number;
  } | undefined;

  const count = (value: unknown): number => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  };
  const dailyUsed = Math.min(OMDA_AGENT_POLICY.dailyLimit, count(row?.daily_used));
  const minuteUsed = Math.min(OMDA_AGENT_POLICY.perMinuteLimit, count(row?.minute_used));

  return {
    initialized: true,
    scope: 'max_per_profile',
    limits: { daily: OMDA_AGENT_POLICY.dailyLimit, perMinute: OMDA_AGENT_POLICY.perMinuteLimit },
    usage: {
      daily: dailyUsed,
      perMinute: minuteUsed,
      observedProfiles: count(row?.observed_profiles),
    },
    remaining: {
      daily: Math.max(0, OMDA_AGENT_POLICY.dailyLimit - dailyUsed),
      perMinute: Math.max(0, OMDA_AGENT_POLICY.perMinuteLimit - minuteUsed),
    },
    resetsAt: { daily: dailyReset, perMinute: minuteReset },
  };
}
