import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { backupDbNow, restoreDbBackupIfNeeded, startDbBackupPump } from '../../lib/db-backup.js';

/**
 * Uses only synthetic, local SQLite fixtures.
 * No HTTP requests, secrets, production databases, or backup writes.
 */
const keys = [
  'FREEAPI_DB_BACKUP_PATH',
  'FREEAPI_DB_BACKUP_TARGET',
  'FREEAPI_DB_BACKUP_URL',
  'FREEAPI_DB_BACKUP_KEY',
  'FREEAPI_DB_BACKUP_TOKEN',
  'FREEAPI_DB_BACKUP_RESTORE_ONLY',
  'ENCRYPTION_KEY',
] as const;
const saved = Object.fromEntries(keys.map(k => [k, process.env[k]])) as Record<(typeof keys)[number], string | undefined>;
const dirs: string[] = [];

function setupFixture() {
  for (const key of keys) delete process.env[key];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omda-restore-only-'));
  dirs.push(dir);
  const dbPath = path.join(dir, 'source.db');
  const backupPath = path.join(dir, 'source-backup.encrypted');
  const destinationPath = path.join(dir, 'restored.db');
  process.env.ENCRYPTION_KEY = 'a'.repeat(64); // deliberately fake testing key
  process.env.FREEAPI_DB_BACKUP_TARGET = backupPath;
  const db = new Database(dbPath);
  db.exec("CREATE TABLE provider_state (provider TEXT, value TEXT); INSERT INTO provider_state VALUES ('fixture', 'synthetic-only');");
  return { db, dbPath, backupPath, destinationPath };
}

afterEach(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('OMDA restore-only migration with encrypted SQLite fixtures', () => {
  it('restores SQLite safely, skips writes, and leaves encrypted source byte-for-byte identical', async () => {
    const { db, dbPath, backupPath, destinationPath } = setupFixture();
    try {
      expect((await backupDbNow(db, dbPath)).ok).toBe(true);
    } finally {
      db.close();
    }
    const sourceBefore = fs.readFileSync(backupPath);
    const hashBefore = crypto.createHash('sha256').update(sourceBefore).digest('hex');

    process.env.FREEAPI_DB_BACKUP_RESTORE_ONLY = 'true';
    expect(await backupDbNow({} as never, dbPath))
      .toEqual({ ok: true, skipped: 'restore-only mode: backup writes disabled' });

    let scheduled = false;
    expect(startDbBackupPump({} as never, { every: () => { scheduled = true; } } as never, dbPath)).toBeNull();
    expect(scheduled).toBe(false);

    const restored = await restoreDbBackupIfNeeded(destinationPath);
    expect(restored.restored).toBe(true);
    const restoredDb = new Database(destinationPath, { readonly: true });
    try {
      expect(restoredDb.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(restoredDb.prepare('SELECT value FROM provider_state WHERE provider = ?').get('fixture'))
        .toEqual({ value: 'synthetic-only' });
    } finally {
      restoredDb.close();
    }
    expect((await restoreDbBackupIfNeeded(destinationPath)).skipped).toBe('database already exists');
    expect(crypto.createHash('sha256').update(fs.readFileSync(backupPath)).digest('hex')).toBe(hashBefore);
  });

  it('fails closed with the wrong encryption key and never creates a destination', async () => {
    const { db, dbPath, destinationPath } = setupFixture();
    try {
      await backupDbNow(db, dbPath);
    } finally {
      db.close();
    }
    process.env.FREEAPI_DB_BACKUP_RESTORE_ONLY = 'true';
    process.env.FREEAPI_DB_BACKUP_KEY = 'b'.repeat(64); // wrong synthetic key overrides ENCRYPTION_KEY
    await expect(restoreDbBackupIfNeeded(destinationPath)).rejects.toThrow('could not restore SQLite backup');
    expect(fs.existsSync(destinationPath)).toBe(false);
  });

  it('rejects tampered encrypted backups without overwriting the clean backup', async () => {
    const { db, dbPath, backupPath, destinationPath } = setupFixture();
    try {
      await backupDbNow(db, dbPath);
    } finally {
      db.close();
    }
    const original = fs.readFileSync(backupPath);
    const tampered = Buffer.from(original);
    tampered[tampered.length - 1] ^= 1;
    const tamperedPath = path.join(path.dirname(backupPath), 'tampered.encrypted');
    fs.writeFileSync(tamperedPath, tampered);
    process.env.FREEAPI_DB_BACKUP_TARGET = tamperedPath;
    process.env.FREEAPI_DB_BACKUP_RESTORE_ONLY = 'true';
    await expect(restoreDbBackupIfNeeded(destinationPath)).rejects.toThrow('could not restore SQLite backup');
    expect(fs.existsSync(destinationPath)).toBe(false);
    expect(fs.readFileSync(backupPath)).toEqual(original);
  });
});
