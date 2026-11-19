import { Router } from 'express';
import { getDb } from '../db/index.js';
import {
  inspectOmdaAgentPayload,
  OMDA_AGENT_POLICY,
  readOmdaAgentQuotaStatus,
} from '../lib/omda-agent-policy.js';

export const omdaAgentOpsRouter = Router();

function inferenceEnabled(): boolean {
  return process.env.OMDA_AGENT_INFERENCE_ALLOWED === 'true';
}

function noStore(res: { setHeader(name: string, value: string): unknown }): void {
  res.setHeader('Cache-Control', 'no-store');
}

omdaAgentOpsRouter.get('/policy', (_req, res) => {
  noStore(res);
  res.json({
    policy: OMDA_AGENT_POLICY,
    inferenceEnabled: inferenceEnabled(),
    execution: {
      preflightOnly: true,
      providerCalls: false,
      quotaReservations: false,
    },
  });
});

omdaAgentOpsRouter.get('/quota', (_req, res) => {
  noStore(res);
  try {
    res.json(readOmdaAgentQuotaStatus(getDb()));
  } catch {
    res.status(503).json({
      error: {
        type: 'omda_agent_quota_unavailable',
        message: 'Quota status is temporarily unavailable.',
      },
    });
  }
});

omdaAgentOpsRouter.post('/preflight', (req, res) => {
  noStore(res);
  const inspection = inspectOmdaAgentPayload(req.body);
  const enabled = inferenceEnabled();

  try {
    const quota = readOmdaAgentQuotaStatus(getDb());
    const blockers = [...inspection.reasonCodes];
    if (!enabled) blockers.push('server_inference_disabled');
    if (!quota.initialized) {
      blockers.push('quota_store_not_initialized');
    } else {
      if (quota.remaining.daily <= 0) blockers.push('daily_quota_exhausted');
      if (quota.remaining.perMinute <= 0) blockers.push('minute_quota_exhausted');
    }

    res.json({
      policyVersion: OMDA_AGENT_POLICY.version,
      policyMatch: inspection.allowed,
      eligibleForAttempt: blockers.length === 0,
      blockers,
      requestMetadata: inspection.metadata,
      server: { inferenceEnabled: enabled },
      quota,
      sideEffects: {
        providerCalled: false,
        quotaReserved: false,
        promptPersisted: false,
      },
      note: 'Eligibility is advisory only. The inference guard revalidates and reserves quota atomically.',
    });
  } catch {
    res.status(503).json({
      error: {
        type: 'omda_agent_preflight_unavailable',
        message: 'Preflight could not read the current quota state.',
      },
      policyMatch: inspection.allowed,
      requestMetadata: inspection.metadata,
      sideEffects: {
        providerCalled: false,
        quotaReserved: false,
        promptPersisted: false,
      },
    });
  }
});
