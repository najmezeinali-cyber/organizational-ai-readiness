import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { settings } from './config';

let instance: DatabaseSync | undefined;
let lastCleanup = 0;
export function db() {
  if (!instance) {
    instance = new DatabaseSync(path.join(settings().dataDir, 'application.sqlite'));
    instance.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, position TEXT NOT NULL DEFAULT '',
        password TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0,
        role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')), created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_tokens (
        hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')), expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assessments (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        domain TEXT NOT NULL, task TEXT NOT NULL, other_title TEXT NOT NULL DEFAULT '',
        content_version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','completed')),
        revision INTEGER NOT NULL DEFAULT 0, answers TEXT NOT NULL DEFAULT '{}', report TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS single_draft ON assessments(owner_id) WHERE status='draft';
      CREATE INDEX IF NOT EXISTS owner_assessments ON assessments(owner_id);
      CREATE TABLE IF NOT EXISTS admin_views (
        hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES sessions(hash) ON DELETE CASCADE,
        assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL
      );
      PRAGMA user_version=1;
    `);
    try { instance.exec("ALTER TABLE users ADD COLUMN position TEXT NOT NULL DEFAULT ''"); } catch { /* existing database already migrated */ }
  }
  if (Date.now() - lastCleanup > 3_600_000) {
    const now = Date.now();
    instance.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
    instance.prepare('DELETE FROM auth_tokens WHERE expires < ?').run(now);
    instance.prepare('DELETE FROM admin_views WHERE expires < ?').run(now);
    instance.prepare('DELETE FROM rate_limits WHERE expires < ?').run(now);
    const cutoff = new Date(now - 180 * 86400000).toISOString();
    instance.prepare('DELETE FROM assessments WHERE updated_at < ?').run(cutoff);
    lastCleanup = now;
  }
  return instance;
}

export function transaction<T>(fn: () => T): T {
  const connection = db();
  connection.exec('BEGIN IMMEDIATE');
  try { const value = fn(); connection.exec('COMMIT'); return value; }
  catch (error) { connection.exec('ROLLBACK'); throw error; }
}

export function closeDatabase() { instance?.close(); instance = undefined; lastCleanup = 0; }
