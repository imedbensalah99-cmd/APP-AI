import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { planOmdaTask } from '../services/omda-task-planner.js';

export const omdaTasksRouter = Router();

const planSchema = z.object({
  request: z.string().trim().min(5).max(4000),
  locale: z.enum(['ar', 'en']).optional(),
}).strict();

omdaTasksRouter.post('/plan', (req: Request, res: Response) => {
  const parsed = planSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: {
        type: 'invalid_request_error',
        message: 'Provide a request between 5 and 4000 characters and an optional ar/en locale.',
      },
    });
    return;
  }

  try {
    const plan = planOmdaTask(parsed.data.request, parsed.data.locale ?? 'en');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).json(plan);
  } catch (error) {
    res.status(400).json({
      error: {
        type: 'invalid_request_error',
        message: error instanceof Error ? error.message : 'Unable to create task plan',
      },
    });
  }
});
