import { describe, expect, it } from 'vitest';
import {
  hashTaskSessionEvent,
  resolveTaskSessionTransition,
  TASK_SESSION_ZERO_HASH,
  TaskSessionError,
  verifyTaskSessionEventChain,
  type VerifiableTaskSessionEvent,
} from '../../lib/omda-task-session-core.js';

function event(input: Omit<VerifiableTaskSessionEvent, 'eventHash'>): VerifiableTaskSessionEvent {
  return { ...input, eventHash: hashTaskSessionEvent(input) };
}

describe('OMDA task session lifecycle core', () => {
  it('allows only documented forward transitions', () => {
    expect(resolveTaskSessionTransition('draft', 'start')).toBe('running');
    expect(resolveTaskSessionTransition('running', 'pause')).toBe('paused');
    expect(resolveTaskSessionTransition('paused', 'resume')).toBe('running');
    expect(resolveTaskSessionTransition('running', 'complete')).toBe('completed');
    expect(resolveTaskSessionTransition('draft', 'cancel')).toBe('cancelled');
  });

  it('rejects transitions from terminal states and invalid state/action pairs', () => {
    expect(() => resolveTaskSessionTransition('completed', 'resume')).toThrow(TaskSessionError);
    expect(() => resolveTaskSessionTransition('draft', 'pause')).toThrow(TaskSessionError);
    expect(() => resolveTaskSessionTransition('cancelled', 'start')).toThrow(TaskSessionError);
  });

  it('verifies a canonical append-only event chain', () => {
    const created = event({
      sessionId: 'session-1', seq: 0, action: 'created', fromStatus: null,
      toStatus: 'draft', note: null, occurredAt: '2026-11-23T04:00:00.000Z',
      previousHash: TASK_SESSION_ZERO_HASH,
    });
    const started = event({
      sessionId: 'session-1', seq: 1, action: 'start', fromStatus: 'draft',
      toStatus: 'running', note: null, occurredAt: '2026-11-23T04:01:00.000Z',
      previousHash: created.eventHash,
    });
    const paused = event({
      sessionId: 'session-1', seq: 2, action: 'pause', fromStatus: 'running',
      toStatus: 'paused', note: 'Waiting for review', occurredAt: '2026-11-23T04:02:00.000Z',
      previousHash: started.eventHash,
    });

    expect(verifyTaskSessionEventChain([created, started, paused], { status: 'paused', revision: 2 }))
      .toMatchObject({ valid: true, eventCount: 3, lastHash: paused.eventHash });
  });

  it('detects event edits, sequence gaps, and revision drift', () => {
    const created = event({
      sessionId: 'session-2', seq: 0, action: 'created', fromStatus: null,
      toStatus: 'draft', note: null, occurredAt: '2026-11-23T04:00:00.000Z',
      previousHash: TASK_SESSION_ZERO_HASH,
    });
    const tampered = { ...created, note: 'edited after the fact' };
    expect(verifyTaskSessionEventChain([tampered], { status: 'draft', revision: 0 }).reason)
      .toBe('event_hash_mismatch');
    expect(verifyTaskSessionEventChain([{ ...created, seq: 1 }], { status: 'draft', revision: 0 }).reason)
      .toBe('sequence_gap');
    expect(verifyTaskSessionEventChain([created], { status: 'draft', revision: 1 }).reason)
      .toBe('revision_mismatch');
  });
});
