import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextRequest } from 'next/server';
import { db } from './db';
import { settings } from './config';
import type { User } from './types';

const scryptAsync = promisify(scrypt);
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export const cookieName = () => settings().production ? '__Host-readiness' : 'readiness-session';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function fail(status: number, message: string): never { throw new HttpError(status, message); }
export function checkMutation(request: NextRequest) {
  const config = settings();
  const origin = request.headers.get('origin');
  const allowed = [config.origin];
  if (!config.production) allowed.push('http://localhost:3000', 'http://127.0.0.1:3000');
  if (!origin || !allowed.includes(origin) || request.headers.get('x-app-request') !== '1' || !request.headers.get('content-type')?.startsWith('application/json')) {
    fail(403, 'درخواست معتبر نیست. صفحه را تازه کنید و دوباره تلاش کنید.');
  }
}
export function limit(key: string, max = 10, windowMs = 900000) {
  const digest = createHmac('sha256', settings().secret).update(key).digest('hex');
  const now = Date.now();
  const row = db().prepare(`INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires < ? THEN 1 ELSE count+1 END,
    expires=CASE WHEN expires < ? THEN excluded.expires ELSE expires END RETURNING count`).get(digest, now + windowMs, now, now) as { count: number };
  if (row.count > max) fail(429, 'تعداد تلاش‌ها زیاد است. کمی بعد دوباره امتحان کنید.');
}
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex || hex.length !== 128) return false;
  const actual = await scryptAsync(password, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}
export function publicUser(row: Record<string, unknown>): User {
  return { id: String(row.id), name: String(row.name), email: String(row.email), position: String(row.position || ''), verified: Boolean(row.verified), role: row.role === 'admin' ? 'admin' : 'user' };
}
export function session(request: NextRequest) {
  const raw = request.cookies.get(cookieName())?.value;
  if (!raw || raw.length > 150) return null;
  const hash = hashToken(raw);
  const row = db().prepare(`SELECT u.id,u.name,u.email,u.position,u.verified,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?`).get(hash, Date.now()) as Record<string, unknown> | undefined;
  return row ? { user: publicUser(row), hash } : null;
}
export function requireUser(request: NextRequest, verified = true) {
  const current = session(request);
  if (!current) fail(401, 'برای ادامه وارد حساب خود شوید.');
  if (verified && !current.user.verified) fail(403, 'ابتدا ایمیل خود را تأیید کنید.');
  return current;
}
export function requireAdmin(request: NextRequest) {
  const current = requireUser(request);
  if (current.user.role !== 'admin') fail(403, 'دسترسی به این بخش مجاز نیست.');
  return current;
}
export function newSession(userId: string) {
  const raw = randomToken();
  db().prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(hashToken(raw), userId, Date.now() + 7 * 86400000);
  return raw;
}
export function newAuthToken(userId: string, purpose: 'verify' | 'reset') {
  const raw = randomToken();
  db().prepare('INSERT INTO auth_tokens(hash,user_id,purpose,expires) VALUES(?,?,?,?)').run(hashToken(raw), userId, purpose, Date.now() + (purpose === 'verify' ? 86400000 : 1800000));
  return raw;
}
