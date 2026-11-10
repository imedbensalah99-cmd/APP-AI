import { createServer } from 'node:http';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { omdaArtifactsRouter } from './omda-artifacts.js';

async function withServer<T>(run: (origin: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use('/api/omda/artifacts', omdaArtifactsRouter);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe('OMDA XLSX artifact route handler', () => {
  it('returns an actual XLSX attachment with safe download headers', async () => {
    await withServer(async origin => {
      const response = await fetch(`${origin}/api/omda/artifacts/xlsx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetName: 'Job Tracker',
          columns: ['Company', 'Role', 'Status'],
          rows: [['Gulf Exchange', 'AML Analyst', 'Draft']],
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
      expect(response.headers.get('content-disposition')).toBe('attachment; filename="omda-export.xlsx"');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
      expect(bytes.length).toBeGreaterThan(200);
    });
  });

  it('rejects ragged rows and unexpected fields without returning a file', async () => {
    await withServer(async origin => {
      const response = await fetch(`${origin}/api/omda/artifacts/xlsx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns: ['Company', 'Role'], rows: [['Only one cell']], path: '../../etc/passwd' }),
      });
      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/json');
      const body = await response.json() as { error: { type: string } };
      expect(body.error.type).toBe('invalid_request_error');
    });
  });
});
