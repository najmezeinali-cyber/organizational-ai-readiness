import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, transaction } from '@/lib/db';
import { settings } from '@/lib/config';
import { checkMutation, cookieName, fail, hashToken, HttpError, limit, newAuthToken, newSession, passwordHash, passwordMatches, publicUser, randomToken, requireAdmin, requireUser, session } from '@/lib/auth';
import { sendAccountEmail } from '@/lib/mail';
import { createAssessment, finalizeAssessment, listAssessments, ownedAssessment, saveAnswer } from '@/lib/assessments';
import { demoReport } from '@/lib/demo';
import { generatePdf } from '@/lib/pdf';
import type { Answer, Domain, Report } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store, max-age=0' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });
const optionalText = (schema: z.ZodString) => z.preprocess((value) => value === '' ? undefined : value, schema.optional()) as unknown as z.ZodOptional<z.ZodString>;
const authSchema = z.object({ action: z.enum(['guest-register', 'register', 'login', 'forgot', 'resend', 'verify', 'reset', 'logout', 'delete']), name: optionalText(z.string().trim().min(2).max(80)), email: z.email().max(254).transform((s) => s.trim().toLowerCase()).optional(), position: optionalText(z.string().trim().min(2).max(100)), password: optionalText(z.string().max(128)), token: optionalText(z.string().min(32).max(128)), consent: z.boolean().optional(), confirmation: optionalText(z.string()) });
const passwordPolicy = (password?: string) => { if (!password || password.length < 10 || password.length > 128) fail(400, 'رمز عبور باید بین ۱۰ تا ۱۲۸ نویسه باشد.'); return password; };
function setCookie(response: NextResponse, value: string) {
  response.cookies.set(cookieName(), value, { httpOnly: true, secure: settings().production, sameSite: 'lax', path: '/', maxAge: value ? 7 * 86400 : 0 });
  return response;
}
async function body(request: NextRequest) {
  checkMutation(request);
  const text = await request.text();
  if (text.length > 16000) fail(413, 'حجم درخواست بیش از حد مجاز است.');
  try { return JSON.parse(text); } catch { fail(400, 'اطلاعات درخواست معتبر نیست.'); }
}
async function account(request: NextRequest) {
  limit('auth-global', 500, 900000);
  const parsed = authSchema.safeParse(await body(request));
  if (!parsed.success) fail(400, 'اطلاعات واردشده معتبر نیست. ایمیل و فیلدها را بررسی کنید.');
  const input = parsed.data;
  const mailNotice = settings().mailMode === 'file' ? 'حالت آزمایش محلی: ایمیل ارسال نشده؛ لینک در صندوق خصوصی .data/outbox برای راه‌انداز سامانه ذخیره می‌شود.' : 'اگر حساب واجد شرایط باشد، پیام ارسال می‌شود. صندوق ایمیل و پوشه هرزنامه را بررسی کنید.';
  if (input.action === 'guest-register') {
    if (!input.name || !input.email || !input.position || input.consent !== true) fail(400, 'نام، ایمیل، سمت و پذیرش اطلاعیه حریم خصوصی لازم است.');
    limit(`guest:${input.email}`, 3, 900000);
    if (db().prepare('SELECT id FROM users WHERE email=?').get(input.email)) fail(409, 'این ایمیل قبلاً برای یک ارزیابی استفاده شده است. برای شروع آزمایشی از ایمیل دیگری استفاده کنید.');
    const id = randomUUID();
    const internalPassword = await passwordHash(randomToken());
    db().prepare('INSERT INTO users(id,name,email,position,password,verified,created_at) VALUES(?,?,?,?,?,1,?)').run(id, input.name, input.email, input.position, internalPassword, new Date().toISOString());
    const row = db().prepare('SELECT * FROM users WHERE id=?').get(id)!;
    return setCookie(json({ ok: true, user: publicUser(row) }), newSession(id));
  }
  if (['register', 'login', 'forgot', 'resend'].includes(input.action)) {
    if (!input.email) fail(400, 'ایمیل خود را وارد کنید.');
    limit(`${input.action}:${input.email}`, input.action === 'login' ? 12 : 5);
  }
  if (input.action === 'register') {
    const password = passwordPolicy(input.password);
    if (!input.name || input.consent !== true) fail(400, 'نام و پذیرش اطلاعیه حریم خصوصی لازم است.');
    const existing = db().prepare('SELECT id,verified FROM users WHERE email=?').get(input.email!) as { id: string; verified: number } | undefined;
    if (!existing) {
      const id = randomUUID();
      const passwordValue = await passwordHash(password);
      const localPilot = process.env.NODE_ENV === 'development' && settings().mailMode === 'file';
      db().prepare('INSERT INTO users(id,name,email,password,verified,created_at) VALUES(?,?,?,?,?,?)').run(id, input.name, input.email!, passwordValue, localPilot ? 1 : 0, new Date().toISOString());
      if (localPilot) {
        const row = db().prepare('SELECT * FROM users WHERE id=?').get(id)!;
        return setCookie(json({ ok: true, user: publicUser(row), message: 'حساب آزمایشی محلی فعال شد؛ می‌توانید مستقیماً وارد ارزیابی شوید.' }), newSession(id));
      }
      await sendAccountEmail(input.email!, newAuthToken(id, 'verify'), 'verify');
    }
    return json({ ok: true, message: `در صورت ثبت حساب جدید، تأیید ایمیل لازم است. اگر حساب دارید وارد شوید. ${mailNotice}` });
  }
  if (input.action === 'login') {
    if (!input.password || input.password.length > 128) fail(400, 'ایمیل و رمز عبور را وارد کنید.');
    const row = db().prepare('SELECT * FROM users WHERE email=?').get(input.email!) as Record<string, unknown> | undefined;
    const stored = row ? String(row.password) : `${'0'.repeat(32)}:${'0'.repeat(128)}`;
    const valid = await passwordMatches(input.password, stored);
    if (!row || !valid) fail(401, 'ایمیل یا رمز عبور درست نیست.');
    return setCookie(json({ ok: true, user: publicUser(row) }), newSession(String(row.id)));
  }
  if (input.action === 'forgot' || input.action === 'resend') {
    const row = db().prepare('SELECT id,verified FROM users WHERE email=?').get(input.email!) as { id: string; verified: number } | undefined;
    const purpose = input.action === 'forgot' ? 'reset' : 'verify';
    if (row && (purpose === 'reset' || !row.verified)) await sendAccountEmail(input.email!, newAuthToken(row.id, purpose), purpose);
    return json({ ok: true, message: mailNotice });
  }
  if (input.action === 'verify' || input.action === 'reset') {
    limit(`token:${input.token?.slice(0, 12) || 'missing'}`, 10);
    if (!input.token) fail(400, 'لینک معتبر نیست.');
    const purpose = input.action === 'verify' ? 'verify' : 'reset';
    const password = purpose === 'reset' ? await passwordHash(passwordPolicy(input.password)) : null;
    const userId = transaction(() => {
      const row = db().prepare('DELETE FROM auth_tokens WHERE hash=? AND purpose=? AND expires>? RETURNING user_id').get(hashToken(input.token!), purpose, Date.now()) as { user_id: string } | undefined;
      if (!row) fail(400, 'لینک منقضی شده یا قبلاً استفاده شده است؛ لینک تازه درخواست کنید.');
      if (purpose === 'verify') db().prepare('UPDATE users SET verified=1 WHERE id=?').run(row.user_id);
      else {
        db().prepare('UPDATE users SET password=? WHERE id=?').run(password!, row.user_id);
        db().prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
      }
      db().prepare('DELETE FROM auth_tokens WHERE user_id=? AND purpose=?').run(row.user_id, purpose);
      return row.user_id;
    });
    if (purpose === 'verify') {
      const row = db().prepare('SELECT * FROM users WHERE id=?').get(userId)!;
      return setCookie(json({ ok: true, user: publicUser(row), message: 'ایمیل شما تأیید شد.' }), newSession(userId));
    }
    return setCookie(json({ ok: true, message: 'رمز عبور تغییر کرد. دوباره وارد شوید.' }), '');
  }
  if (input.action === 'logout') {
    const current = session(request);
    if (current) db().prepare('DELETE FROM sessions WHERE hash=?').run(current.hash);
    return setCookie(json({ ok: true }), '');
  }
  const current = requireUser(request, false);
  limit(`delete:${current.user.id}`, 5);
  if (input.confirmation !== 'DELETE' || !input.password) fail(400, 'برای حذف حساب، رمز و تأیید صریح لازم است.');
  const row = db().prepare('SELECT password FROM users WHERE id=?').get(current.user.id) as { password: string };
  if (!await passwordMatches(input.password, row.password)) fail(400, 'رمز عبور درست نیست.');
  transaction(() => { db().prepare('DELETE FROM users WHERE id=?').run(current.user.id); });
  return setCookie(json({ ok: true, message: 'حساب و اطلاعات فعال آن حذف شد.' }), '');
}

async function pdfResponse(report: Report, options: { name?: string; demo?: boolean; anonymous?: boolean }) {
  limit('pdf-global', 30, 60000);
  const bytes = await generatePdf(report, options);
  return new NextResponse(new Uint8Array(bytes), { headers: { ...noStore, 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="ai-readiness-report.pdf"' } });
}
function adminReport(request: NextRequest, token: string) {
  const current = requireAdmin(request);
  const row = db().prepare(`SELECT a.report FROM admin_views v JOIN assessments a ON a.id=v.assessment_id WHERE v.hash=? AND v.session_hash=? AND v.expires>? AND a.status='completed'`).get(hashToken(token), current.hash, Date.now()) as { report: string } | undefined;
  if (!row) fail(404, 'دسترسی نتیجه منقضی شده است؛ فهرست نتایج را تازه کنید.');
  return JSON.parse(row.report) as Report;
}
async function route(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const segments = (await context.params).path;
    const key = segments.join('/');
    if (key === 'me' && request.method === 'GET') return json({ user: session(request)?.user || null, mailMode: settings().mailMode });
    if (key === 'auth' && request.method === 'POST') return await account(request);
    if (key === 'demo/pdf' && request.method === 'GET') {
      return await pdfResponse(demoReport(), { demo: true });
    }
    if (key === 'assessments') {
      const current = requireUser(request);
      if (request.method === 'GET') return json({ user: current.user, assessments: listAssessments(current.user.id) });
      if (request.method === 'POST') {
        const data = await body(request);
        const parsed = z.object({ domain: z.enum(['engineering', 'procurement', 'project']), task: z.string().min(1).max(50), otherTitle: z.string().max(120).optional() }).safeParse(data);
        if (!parsed.success) fail(400, 'انتخاب حوزه یا کار معتبر نیست.');
        limit(`create:${current.user.id}`, 20, 86400000);
        return json({ assessment: createAssessment(current.user.id, parsed.data.domain, parsed.data.task, parsed.data.otherTitle) });
      }
    }
    if (segments[0] === 'assessments' && segments.length === 2) {
      const current = requireUser(request);
      const id = segments[1];
      if (request.method === 'GET') return json({ assessment: ownedAssessment(id, current.user.id), user: current.user });
      const data = await body(request);
      if (request.method === 'DELETE') {
        const assessment = ownedAssessment(id, current.user.id);
        if (assessment.status !== 'draft') fail(409, 'گزارش نهایی قابل حذف تکی نیست؛ برای حذف همه داده‌ها از حذف حساب استفاده کنید.');
        db().prepare("DELETE FROM assessments WHERE id=? AND owner_id=? AND status='draft'").run(id, current.user.id);
        return json({ ok: true });
      }
      if (!Number.isSafeInteger(data.revision) || data.revision < 0) fail(400, 'نسخه پاسخ معتبر نیست.');
      if (request.method === 'PATCH') {
        if (typeof data.questionId !== 'string' || data.questionId.length > 8 || ![0, 1, 2, 3, 'unknown'].includes(data.answer)) fail(400, 'پاسخ معتبر نیست.');
        limit(`save:${current.user.id}`, 150, 60000);
        return json({ assessment: saveAnswer(current.user.id, id, data.revision, data.questionId, data.answer) });
      }
      if (request.method === 'POST' && data.action === 'finalize') return json({ assessment: finalizeAssessment(current.user.id, id, data.revision) });
    }
    if (segments[0] === 'report' && segments[2] === 'pdf' && segments.length === 3 && request.method === 'GET') {
      const current = requireUser(request);
      const assessment = ownedAssessment(segments[1], current.user.id);
      if (!assessment.report) fail(409, 'ابتدا ارزیابی را تکمیل کنید.');
      return await pdfResponse(assessment.report, { name: current.user.name });
    }
    if (key === 'admin' && request.method === 'GET') {
      const current = requireAdmin(request);
      const token = request.nextUrl.searchParams.get('token');
      if (token) return json({ report: adminReport(request, token) });
      const view = request.nextUrl.searchParams.get('view');
      if (view === 'users') {
        const users = db().prepare(`SELECT u.name,u.email,CASE WHEN EXISTS(SELECT 1 FROM assessments a WHERE a.owner_id=u.id AND a.status='draft') THEN 'در حال تکمیل' WHEN EXISTS(SELECT 1 FROM assessments a WHERE a.owner_id=u.id AND a.status='completed') THEN 'تکمیل‌شده' ELSE 'شروع‌نشده' END AS status FROM users u ORDER BY u.name LIMIT 200`).all();
        return json({ users });
      }
      if (view === 'results') {
        const rows = db().prepare("SELECT id,domain,report FROM assessments WHERE status='completed' ORDER BY random() LIMIT 100").all() as { id: string; domain: Domain; report: string }[];
        // Tokens are random, session-bound and short-lived; no underlying ID is exposed.
        db().prepare('DELETE FROM admin_views WHERE session_hash=?').run(current.hash);
        const results = rows.map((row) => {
          const viewToken = randomToken();
          db().prepare('INSERT INTO admin_views(hash,session_hash,assessment_id,expires) VALUES(?,?,?,?)').run(hashToken(viewToken), current.hash, row.id, Date.now() + 900000);
          return { token: viewToken, domain: row.domain, report: JSON.parse(row.report) as Report };
        });
        return json({ results });
      }
      fail(400, 'بخش پنل مشخص نیست.');
    }
    if (key === 'admin/pdf' && request.method === 'GET') {
      return await pdfResponse(adminReport(request, request.nextUrl.searchParams.get('token') || ''), { anonymous: true });
    }
    fail(404, 'مسیر پیدا نشد.');
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('API operation failed:', error instanceof Error ? error.name : 'UnknownError');
    return json({ error: 'انجام درخواست ممکن نشد. اگر در حال ساخت PDF هستید کمی بعد تلاش کنید؛ برای ایمیل، تنظیمات سرویس و ارسال مجدد را بررسی کنید.' }, 500);
  }
}
export { route as GET, route as POST, route as PATCH, route as DELETE };
