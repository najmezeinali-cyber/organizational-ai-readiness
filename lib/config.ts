import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export function settings() {
  const origin = process.env.APP_URL || 'http://localhost:3000';
  const originUrl = new URL(origin);
  const local = originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1';
  const production = process.env.NODE_ENV === 'production' && !local;
  const dataDir = path.resolve(process.env.DATA_DIR || '.data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const mailMode = process.env.MAIL_MODE || (production ? 'smtp' : 'file');
  let secret = process.env.APP_SECRET;
  if (production && (!secret || secret.length < 32 || !process.env.APP_URL || !origin.startsWith('https:') || mailMode !== 'smtp' || !process.env.SMTP_HOST || !process.env.MAIL_FROM)) {
    throw new Error('Production requires HTTPS APP_URL, APP_SECRET (32+ characters), MAIL_MODE=smtp, SMTP_HOST and MAIL_FROM.');
  }
  if (!secret) {
    const secretPath = path.join(dataDir, 'development-secret');
    if (!existsSync(secretPath)) {
      try { writeFileSync(secretPath, randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (!existsSync(secretPath)) throw error; }
    }
    secret = readFileSync(secretPath, 'utf8').trim();
  }
  if (!['file', 'smtp'].includes(mailMode)) throw new Error('MAIL_MODE must be file or smtp.');
  return { production, dataDir, origin: new URL(origin).origin, mailMode: mailMode as 'file' | 'smtp', secret };
}
