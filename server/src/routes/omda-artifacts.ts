import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { buildXlsx, XLSX_CONTENT_TYPE } from '../services/omda-xlsx.js';

export const omdaArtifactsRouter = Router();

const cellSchema = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const workbookSchema = z.object({
  columns: z.array(z.string().trim().min(1).max(100)).min(1).max(64),
  rows: z.array(z.array(cellSchema).max(64)).max(1000).default([]),
  sheetName: z.string().max(80).optional(),
}).strict().superRefine((value, context) => {
  value.rows.forEach((row, index) => {
    if (row.length !== value.columns.length) {
      context.addIssue({
        code: 'custom',
        path: ['rows', index],
        message: 'Every row must contain exactly one cell per column',
      });
    }
  });
  const textLength = value.columns.reduce((sum, column) => sum + column.length, 0)
    + value.rows.reduce((sum, row) => sum + row.reduce(
      (rowSum, cell) => rowSum + (typeof cell === 'string' ? cell.length : 0),
      0,
    ), 0);
  if (textLength > 250_000) {
    context.addIssue({ code: 'custom', path: ['rows'], message: 'Workbook text limit exceeded' });
  }
});

omdaArtifactsRouter.post('/xlsx', (req: Request, res: Response) => {
  const parsed = workbookSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: {
        type: 'invalid_request_error',
        message: parsed.error.issues.map(issue => issue.message).join(', '),
      },
    });
    return;
  }

  try {
    const workbook = buildXlsx({
      columns: parsed.data.columns,
      rows: parsed.data.rows,
      sheetName: parsed.data.sheetName,
    });
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="omda-export.xlsx"');
    res.setHeader('Content-Length', String(workbook.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(workbook);
  } catch (error) {
    res.status(400).json({
      error: {
        type: 'invalid_request_error',
        message: error instanceof Error ? error.message : 'Unable to create workbook',
      },
    });
  }
});
