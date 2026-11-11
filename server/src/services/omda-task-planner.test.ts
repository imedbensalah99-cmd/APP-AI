import { describe, expect, it } from 'vitest';
import { planOmdaTask } from './omda-task-planner.js';

describe('OMDA task planner', () => {
  it('creates a website plan and marks public publishing as approval-gated', () => {
    const plan = planOmdaTask('Build a responsive restaurant website');
    expect(plan.categories).toEqual(['website']);
    expect(plan.steps.some(step => step.id === 'website-2')).toBe(true);
    expect(plan.steps.at(-1)?.status).toBe('approval_required');
    expect(plan.guardrails.publicPublishing).toBe(false);
  });

  it('recognizes multiple independent intents in one request', () => {
    const plan = planOmdaTask('Create an Excel tracker and draft an email');
    expect(plan.categories).toEqual(['spreadsheet', 'email_draft']);
    expect(plan.steps.some(step => step.id === 'spreadsheet-2')).toBe(true);
    expect(plan.steps.some(step => step.id === 'email_draft-1')).toBe(true);
  });

  it('recognizes Arabic requests and returns Arabic step labels', () => {
    const plan = planOmdaTask('ابحث عن وظائف AML وجهز مسودة بريد للتقديم', 'ar');
    expect(plan.categories).toContain('job_search');
    expect(plan.categories).toContain('email_draft');
    expect(plan.steps[0]?.title).toBe('تحديد الوظائف وشروط الأهلية');
  });

  it('falls back to a safe general plan when no intent matches', () => {
    const plan = planOmdaTask('Organize my project notes');
    expect(plan.categories).toEqual(['general']);
    expect(plan.steps).toHaveLength(3);
    expect(plan.mode).toBe('plan_only');
  });

  it('rejects empty, short and oversized requests', () => {
    expect(() => planOmdaTask('   ')).toThrow(/at least 5/);
    expect(() => planOmdaTask('tiny')).toThrow(/at least 5/);
    expect(() => planOmdaTask('x'.repeat(4001))).toThrow(/4000/);
  });

  it('never authorizes external writes or paid provider calls', () => {
    const plan = planOmdaTask('Build a website and send an email');
    expect(plan.guardrails.providerCalls).toBe(false);
    expect(plan.guardrails.externalWrites).toBe(false);
    expect(plan.steps.filter(step => step.externalSideEffect).every(step => step.status === 'approval_required')).toBe(true);
  });
});
