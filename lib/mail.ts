import nodemailer from 'nodemailer';
import { mkdir, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { settings } from './config';

export async function sendAccountEmail(email: string, token: string, purpose: 'verify' | 'reset') {
  const config = settings();
  const mode = purpose === 'verify' ? 'verify' : 'reset';
  const url = `${config.origin}/auth?mode=${mode}&token=${encodeURIComponent(token)}`;
  const subject = purpose === 'verify' ? 'تأیید ایمیل — آمادگی و شروع هوش مصنوعی' : 'بازیابی رمز عبور — آمادگی و شروع هوش مصنوعی';
  const text = `${subject}\n\nبرای ادامه این نشانی را باز کنید:\n${url}\n\nاگر این درخواست را ثبت نکرده‌اید، این پیام را نادیده بگیرید. لینک یک‌بارمصرف است.`;
  if (config.mailMode === 'file') {
    if (config.production) throw new Error('Development mail is forbidden in production.');
    const directory = path.join(config.dataDir, 'outbox');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, `${Date.now()}-${randomBytes(6).toString('hex')}.json`), JSON.stringify({ delivered: false, to: email, purpose, subject, text, url }, null, 2), { mode: 0o600 });
    for (const filename of await readdir(directory)) {
      const location = path.join(directory, filename);
      if ((await stat(location)).mtimeMs < Date.now() - 86400000) await unlink(location);
    }
    return;
  }
  if (!process.env.SMTP_HOST || !process.env.MAIL_FROM) throw new Error('SMTP is not configured.');
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    requireTLS: process.env.SMTP_SECURE !== 'true',
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
  await transport.sendMail({ from: process.env.MAIL_FROM, to: email, subject, text });
}
