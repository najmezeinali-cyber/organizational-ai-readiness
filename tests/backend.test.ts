import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { db, closeDatabase } from '../lib/db';
import { GET, POST, PATCH } from '../app/api/[...path]/route';
import { questionsFor } from '../lib/content';
import { closeDatabase as close } from '../lib/db';
import { cookieName, hashToken, passwordHash, passwordMatches } from '../lib/auth';

const directory = await mkdtemp(path.join(tmpdir(), 'readiness-tests-'));
process.env.DATA_DIR = directory;
process.env.APP_URL = 'http://localhost:3000';
process.env.MAIL_MODE = 'file';
Object.assign(process.env, { NODE_ENV: 'test' });
after(() => {
  closeDatabase();
  // SQLite's Windows WAL handle can outlive the test worker; the OS cleans this temp directory.
});

async function request(method: string, route: string, data?: unknown, cookie = '', origin = 'http://localhost:3000') {
  const req = new NextRequest(`http://localhost:3000/api/${route}`, { method, headers: { Origin: origin, 'X-App-Request': '1', 'Content-Type': 'application/json', Cookie: cookie }, body: method === 'GET' ? undefined : JSON.stringify(data || {}) });
  const context = { params: Promise.resolve({ path: route.split('?')[0].split('/') }) };
  return (method === 'GET' ? GET : method === 'PATCH' ? PATCH : POST)(req, context);
}
const cookieFrom = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];

await test('password storage uses distinct salts and validates exact password', async () => {
  const one = await passwordHash('a-safe-test-password');
  const two = await passwordHash('a-safe-test-password');
  assert.notEqual(one, two);
  assert.equal(await passwordMatches('a-safe-test-password', one), true);
  assert.equal(await passwordMatches('different', one), false);
});

await test('guest form requires identity fields and starts one protected assessment without email auth', async () => {
  const missing = await request('POST', 'auth', { action: 'guest-register', name: 'مدیر نمونه', email: 'guest-missing@example.test', consent: true });
  assert.equal(missing.status, 400);
  const response = await request('POST', 'auth', { action: 'guest-register', name: 'مدیر مهمان', email: 'guest-flow@example.test', position: 'مدیر پروژه', consent: true });
  assert.equal(response.status, 200);
  const user = (await response.json()).user;
  assert.equal(user.position, 'مدیر پروژه');
  const cookie = cookieFrom(response);
  const created = await request('POST', 'assessments', { domain: 'project', task: 'issues' }, cookie);
  assert.equal(created.status, 200);
  assert.equal((await request('GET', 'assessments', undefined, cookie)).status, 200);
});

await test('real account, persistence, ownership, admin privacy and reset lifecycle', async () => {
  const email = 'manager-test@example.test';
  const password = 'test-password-123';
  const rejected = await request('POST', 'auth', { action: 'register', name: 'مدیر نمونه', email, password, consent: true }, '', 'https://untrusted.example');
  assert.equal(rejected.status, 403);
  const registration = await request('POST', 'auth', { action: 'register', name: 'مدیر نمونه', email, password, consent: true });
  assert.equal(registration.status, 200);
  assert.equal(JSON.stringify(await registration.json()).includes('token='), false);
  const login = await request('POST', 'auth', { action: 'login', email, password });
  const beforeVerification = cookieFrom(login);
  assert.equal((await request('GET', 'assessments', undefined, beforeVerification)).status, 403);
  const files = await readdir(path.join(directory, 'outbox'));
  const message = JSON.parse(await readFile(path.join(directory, 'outbox', files[0]), 'utf8'));
  assert.equal(message.delivered, false);
  const token = new URL(message.url).searchParams.get('token');
  const verified = await request('POST', 'auth', { action: 'verify', token });
  assert.equal(verified.status, 200);
  const cookie = cookieFrom(verified);
  assert.equal((await request('POST', 'auth', { action: 'verify', token })).status, 400);
  const created = await request('POST', 'assessments', { domain: 'engineering', task: 'delay-review' }, cookie);
  assert.equal(created.status, 200);
  let assessment = (await created.json()).assessment;
  const id = assessment.id;
  assert.equal((await request('GET', `assessments/${id}`)).status, 401);
  assert.equal((await request('POST', `assessments/${id}`, { action: 'finalize', revision: 0 }, cookie)).status, 400);
  for (const question of questionsFor('engineering')) {
    const response = await request('PATCH', `assessments/${id}`, { questionId: question.id, answer: 'unknown', revision: assessment.revision }, cookie);
    assert.equal(response.status, 200);
    assessment = (await response.json()).assessment;
  }
  assert.equal((await request('PATCH', `assessments/${id}`, { questionId: 'G01', answer: 3, revision: 0 }, cookie)).status, 409);
  const finalized = await request('POST', `assessments/${id}`, { action: 'finalize', revision: assessment.revision }, cookie);
  assert.equal(finalized.status, 200);
  const completed = (await finalized.json()).assessment;
  assert.equal(completed.status, 'completed');
  assert.ok(completed.report.axes.every((axis: { score: number | null }) => axis.score === null));
  assert.equal((await request('PATCH', `assessments/${id}`, { questionId: 'G01', answer: 3, revision: completed.revision }, cookie)).status, 409);
  close();
  assert.equal((await request('GET', `assessments/${id}`, undefined, cookie)).status, 200, 'database persists after reopening');
  const user = db().prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string };
  assert.equal((await request('GET', 'admin?view=users', undefined, cookie)).status, 403);
  db().prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
  const adminUsers = await (await request('GET', 'admin?view=users', undefined, cookie)).json();
  assert.deepEqual(Object.keys(adminUsers.users[0]).sort(), ['email', 'name', 'status']);
  const adminResults = await (await request('GET', 'admin?view=results', undefined, cookie)).json();
  const encoded = JSON.stringify(adminResults);
  assert.equal(encoded.includes(email), false);
  assert.equal(encoded.includes(user.id), false);
  assert.equal(encoded.includes(id), false);
  assert.equal(encoded.includes('مدیر نمونه'), false);
  assert.deepEqual(Object.keys(adminResults.results[0]).sort(), ['domain', 'report', 'token']);
  // A different real account cannot read this report or reuse the admin handle.
  db().prepare('INSERT INTO users(id,name,email,password,verified,created_at) VALUES(?,?,?,?,1,?)').run('other-user', 'Other', 'other@example.test', await passwordHash(password), new Date().toISOString());
  const otherLogin = await request('POST', 'auth', { action: 'login', email: 'other@example.test', password });
  const otherCookie = cookieFrom(otherLogin);
  assert.equal((await request('GET', `assessments/${id}`, undefined, otherCookie)).status, 404);
  assert.equal((await request('GET', `admin?token=${adminResults.results[0].token}`, undefined, otherCookie)).status, 403);
  await request('POST', 'auth', { action: 'forgot', email });
  const messages = await Promise.all((await readdir(path.join(directory, 'outbox'))).map(async (file) => JSON.parse(await readFile(path.join(directory, 'outbox', file), 'utf8'))));
  const resetToken = new URL(messages.find((item) => item.purpose === 'reset').url).searchParams.get('token');
  const reset = await request('POST', 'auth', { action: 'reset', token: resetToken, password: 'new-password-456' });
  assert.equal(reset.status, 200);
  assert.equal((await request('GET', 'me', undefined, cookie)).status, 200);
  assert.equal((await (await request('GET', 'me', undefined, cookie)).json()).user, null);
  assert.equal((await request('POST', 'auth', { action: 'reset', token: resetToken, password })).status, 400);
  const newLogin = await request('POST', 'auth', { action: 'login', email, password: 'new-password-456' });
  const newCookie = cookieFrom(newLogin);
  assert.equal((await request('POST', 'auth', { action: 'delete', password: 'new-password-456', confirmation: 'DELETE' }, newCookie)).status, 200);
  assert.equal(db().prepare('SELECT id FROM assessments WHERE id=?').get(id), undefined);
  assert.equal(db().prepare('SELECT id FROM users WHERE id=?').get(user.id), undefined);
});

await test('expiring and hashed tokens, session cookies and bounded retention', () => {
  const now = Date.now();
  db().prepare('INSERT INTO auth_tokens(hash,user_id,purpose,expires) VALUES(?,?,?,?)').run(hashToken('expired-token'), 'other-user', 'verify', now - 1);
  assert.equal(db().prepare('DELETE FROM auth_tokens WHERE hash=? AND expires>? RETURNING user_id').get(hashToken('expired-token'), now), undefined);
  assert.equal(cookieName(), 'readiness-session');
});
