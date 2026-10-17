import { test, expect } from '@playwright/test';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const outbox = path.resolve('.data/e2e/outbox');
const screenshots = path.resolve('.data/e2e-screenshots');
const password = 'E2ePilotPassword!2026';

async function newestToken() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const files = (await readdir(outbox)).filter(file => file.endsWith('.json')).sort();
      if (files.length) {
        const payload = JSON.parse(await readFile(path.join(outbox, files.at(-1)!), 'utf8')) as { url: string };
        return new URL(payload.url).searchParams.get('token');
      }
    } catch { /* the mail file may not exist yet */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('No local verification email was written to .data/e2e/outbox');
}

async function answerAll(page: import('@playwright/test').Page) {
  for (let i = 0; i < 30; i++) {
    const options = page.locator('.answer-option');
    await expect(options.first()).toBeVisible();
    await options.nth(1).click();
    if (i < 29) await page.getByRole('button', { name: 'سؤال بعد' }).click();
  }
  await expect(page.getByRole('heading', { name: 'یک بار پاسخ‌ها را مرور کنید.' })).toBeVisible();
}

test.describe('pilot UI journey', () => {
  test('registers, verifies, saves, resumes, finalizes and downloads a report', async ({ page }) => {
    await mkdir(screenshots, { recursive: true });
    const email = `e2e-${Date.now()}@example.test`;
    await page.goto('/auth?mode=register');
    await expect(page.getByRole('heading', { name: 'یک شروع روشن، از همین‌جا.' })).toBeVisible();
    await page.getByLabel('نام شما').fill('مدیر پایلوت');
    await page.getByLabel('ایمیل').fill(email);
    await page.getByLabel('رمز عبور').fill(password);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'ساخت حساب رایگان' }).click();
    await expect(page.getByText('یک قدم تا میز کار شما.')).toBeVisible();
    const token = await newestToken();
    expect(token).toBeTruthy();
    await page.goto(`/auth?mode=verify&token=${encodeURIComponent(token!)}`);
    await page.getByRole('button', { name: 'تأیید ایمیل' }).click();
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByRole('heading', { name: /به میز کارتان خوش آمدید/ })).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, 'workspace-empty.png'), fullPage: true });

    await page.locator('#new').scrollIntoViewIfNeeded();
    await page.getByLabel('می‌خواهید کدام کار را سبک‌تر کنید؟').selectOption('delay-review');
    await page.getByRole('button', { name: 'شروع ارزیابی' }).click();
    await expect(page).toHaveURL(/\/assessment\//);
    await expect(page.getByRole('heading', { name: /برای این کار/ })).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, 'question-desktop.png'), fullPage: true });
    await page.locator('.answer-option').nth(1).click();
    await expect(page.getByText('ذخیره شد')).toBeVisible();
    await page.getByRole('link', { name: 'ذخیره و ادامه بعدی' }).click();
    await expect(page).toHaveURL('/workspace');
    await page.getByRole('link', { name: 'ادامه ارزیابی' }).click();
    await expect(page).toHaveURL(/\/assessment\//);
    await expect(page.locator('.answer-option').nth(1)).toHaveClass(/selected/);
    await answerAll(page);
    await page.getByRole('button', { name: 'ثبت نهایی و دریافت گزارش' }).click();
    await expect(page).toHaveURL(/\/report\//, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'پنج محور، پنج تصویر مستقل' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'نمای جدول' })).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, 'report-desktop.png'), fullPage: true });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: /دریافت گزارش PDF/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);

    await page.goto('/workspace');
    await expect(page.getByText('تکمیل‌شده')).toBeVisible();
    await page.getByRole('link', { name: 'ارزیابی جدید' }).click();
    await expect(page).toHaveURL('/workspace#new');
  });

  test('landing, demo and mobile layouts render their primary content', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /هوش مصنوعی را/ })).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, 'landing-desktop.png'), fullPage: true });
    await page.getByRole('link', { name: 'دیدن نمونه گزارش' }).click();
    await expect(page).toHaveURL('/demo');
    await expect(page.getByText('این گزارش کاملاً فرضی است.')).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /هوش مصنوعی را/ })).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, 'landing-mobile-375.png'), fullPage: true });
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'حریم خصوصی و شرایط پایلوت' })).toBeVisible();
  });
});
