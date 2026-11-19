import { describe, expect, it } from 'vitest';
import type { Db } from '../../db/types.js';
import {
  inspectOmdaAgentPayload,
  OMDA_AGENT_POLICY,
  readOmdaAgentQuotaStatus,
} from '../../lib/omda-agent-policy.js';

function validPayload() {
  return {
    model: OMDA_AGENT_POLICY.model,
    max_tokens: 128,
    temperature: 0.2,
    stream: false,
    messages: [
      { role: 'system', content: 'Follow the approved staging policy.' },
      { role: 'user', content: 'Summarize the supplied status.' },
    ],
  };
}

function fakeDb(options: {
  tableExists: boolean;
  row?: { observed_profiles?: number; daily_used?: number; minute_used?: number };
}) {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        get(..._params: unknown[]) {
          if (sql.includes('sqlite_master')) {
            return options.tableExists ? { name: 'omda_agent_server_quotas' } : undefined;
          }
          if (sql.includes('FROM omda_agent_server_quotas')) {
            return options.row ?? { observed_profiles: 0, daily_used: 0, minute_used: 0 };
          }
          throw new Error('Unexpected SQL in read-only quota test');
        },
      };
    },
  } as unknown as Db;
  return { db, statements };
}

describe('OMDA Agent payload inspection', () => {
  it('accepts only the exact bounded text-chat contract', () => {
    const result = inspectOmdaAgentPayload(validPayload());
    expect(result.allowed).toBe(true);
    expect(result.reasonCodes).toEqual([]);
    expect(result.metadata).toMatchObject({
      messageCount: 2,
      maxTokens: 128,
      temperature: 0.2,
      streaming: false,
      mediaAllowed: false,
      toolsAllowed: false,
    });
  });

  it('never echoes prompt content in inspection output', () => {
    const payload = validPayload();
    payload.messages[1].content = 'private prompt that must not be returned';
    expect(JSON.stringify(inspectOmdaAgentPayload(payload))).not.toContain('private prompt');
  });

  it('rejects extra fields, tool payloads and alternate token-limit fields', () => {
    const payload = { ...validPayload(), tools: [{ type: 'function' }], max_completion_tokens: 512 };
    const result = inspectOmdaAgentPayload(payload);
    expect(result.allowed).toBe(false);
    expect(result.reasonCodes).toContain('fields_must_match_exactly');
  });

  it('rejects an unapproved model, token limit, temperature or streaming mode', () => {
    const cases = [
      { ...validPayload(), model: 'another/model' },
      { ...validPayload(), max_tokens: 129 },
      { ...validPayload(), temperature: 0.3 },
      { ...validPayload(), stream: true },
    ];
    for (const payload of cases) expect(inspectOmdaAgentPayload(payload).allowed).toBe(false);
  });

  it('rejects non-system/user order, arrays, blank content and overlong messages', () => {
    const wrongRole = validPayload();
    wrongRole.messages[0].role = 'user';
    expect(inspectOmdaAgentPayload(wrongRole).reasonCodes).toContain('system_message_invalid');

    const nonString = validPayload();
    nonString.messages[1].content = ['text'] as unknown as string;
    expect(inspectOmdaAgentPayload(nonString).reasonCodes).toContain('user_message_invalid');

    const tooLong = validPayload();
    tooLong.messages[1].content = 'x'.repeat(1001);
    expect(inspectOmdaAgentPayload(tooLong).reasonCodes).toContain('user_message_invalid');

    const blank = validPayload();
    blank.messages[1].content = '';
    expect(inspectOmdaAgentPayload(blank).reasonCodes).toContain('user_message_invalid');
  });

  it('rejects malformed top-level input without throwing', () => {
    for (const value of [null, undefined, [], 'text', 12]) {
      expect(inspectOmdaAgentPayload(value).allowed).toBe(false);
      expect(inspectOmdaAgentPayload(value).reasonCodes).toContain('body_not_object');
    }
  });
});

describe('OMDA Agent quota status', () => {
  const now = new Date('2026-11-19T23:59:30.000Z');

  it('reports an uninitialized store without creating or writing it', () => {
    const { db, statements } = fakeDb({ tableExists: false });
    const result = readOmdaAgentQuotaStatus(db, now);
    expect(result.initialized).toBe(false);
    expect(result.remaining).toEqual({ daily: 10, perMinute: 1 });
    expect(result.resetsAt.daily).toBe('2026-11-20T00:00:00.000Z');
    expect(statements).toHaveLength(1);
    expect(statements.every(sql => sql.trim().toUpperCase().startsWith('SELECT'))).toBe(true);
  });

  it('reports bounded usage and remaining quota without summing profile rows', () => {
    const { db, statements } = fakeDb({
      tableExists: true,
      row: { observed_profiles: 1, daily_used: 9, minute_used: 1 },
    });
    const result = readOmdaAgentQuotaStatus(db, now);
    expect(result.initialized).toBe(true);
    expect(result.usage).toEqual({ daily: 9, perMinute: 1, observedProfiles: 1 });
    expect(result.remaining).toEqual({ daily: 1, perMinute: 0 });
    expect(result.resetsAt.perMinute).toBe('2026-11-20T00:00:00.000Z');
    expect(statements).toHaveLength(2);
    expect(statements.every(sql => sql.trim().toUpperCase().startsWith('SELECT'))).toBe(true);
  });

  it('uses the highest per-profile count and exposes unexpected profile multiplicity', () => {
    const { db } = fakeDb({
      tableExists: true,
      row: { observed_profiles: 2, daily_used: 10, minute_used: 1 },
    });
    const result = readOmdaAgentQuotaStatus(db, now);
    expect(result.scope).toBe('max_per_profile');
    expect(result.usage.observedProfiles).toBe(2);
    expect(result.remaining.daily).toBe(0);
  });

  it('fails closed for an invalid clock value', () => {
    const { db } = fakeDb({ tableExists: false });
    expect(() => readOmdaAgentQuotaStatus(db, new Date(Number.NaN))).toThrow(TypeError);
  });
});
