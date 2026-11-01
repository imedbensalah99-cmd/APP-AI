import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupDbNow, startDbBackupPump, restoreDbBackupIfNeeded } from '../../lib/db-backup.js';

const previous = {
  only: process.env.FREEAPI_DB_BACKUP_RESTORE_ONLY,
  url: process.env.FREEAPI_DB_BACKUP_URL,
};

afterEach(() => {
  if (previous.only === undefined) delete process.env.FREEAPI_DB_BACKUP_RESTORE_ONLY;
  else process.env.FREEAPI_DB_BACKUP_RESTORE_ONLY = previous.only;
  if (previous.url === undefined) delete process.env.FREEAPI_DB_BACKUP_URL;
  else process.env.FREEAPI_DB_BACKUP_URL = previous.url;
});

describe('restore-only migration safeguards', () => {
  it('never writes or schedules an upload while restore-only mode is enabled', async () => {
    process.env.FREEAPI_DB_BACKUP_RESTORE_ONLY = 'true';
    process.env.FREEAPI_DB_BACKUP_URL = 'https://example.invalid/original-backup';

    const result = await backupDbNow({} as never, '/definitely-not-present/source.db');
    expect(result).toEqual({ ok: true, skipped: 'restore-only mode: backup writes disabled' });

    const every = vi.fn();
    expect(startDbBackupPump({} as never, { every } as never)).toBeNull();
    expect(every).not.toHaveBeenCalled();
  });

  it('still permits the restore path to check for a backup', async () => {
    process.env.FREEAPI_DB_BACKUP_RESTORE_ONLY = 'true';
    delete process.env.FREEAPI_DB_BACKUP_URL;
    const result = await restoreDbBackupIfNeeded('/definitely-not-present/target.db');
    expect(result).toEqual({ ok: true, skipped: 'not configured' });
  });
});
