import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const screenshots = path.resolve('.data/e2e-screenshots');

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
  test('requires respondent details, saves, resumes, finalizes and downloads a report', async ({ page }) => {
    await mkdir(screenshots, { recursive: true });
    const email = `e2e-${Date.now()}@example.test`;
    await page.goto('/start');
    await expect(page.getByRole('heading', { name: /از خودتان و کارتان/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'شروع سؤال‌ها' })).toBeDisabled();
    await page.getByLabel('نام و نام خانوادگی').fill('مدیر پایلوت');
    await page.getByLabel('ایمیل کاری یا شخصی').fill(email);
    await page.getByLabel('سمت شما در سازمان').fill('مدیر مهندسی');
    await page.getByLabel('کار تکراری موردنظر').selectOption('delay-review');
    await page.getByRole('checkbox').check();
    await expect(page.getByRole('button', { name: 'شروع سؤال‌ها' })).toBeEnabled();
    await page.getByRole('button', { name: 'شروع سؤال‌ها' }).click();
    await expect(page).toHaveURL(/\/assessment\//);
    await expect(page.locator('.question-card h1')).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, 'question-desktop.png'), fullPage: true });
    await page.locator('.answer-option').nth(1).click();
    await expect(page.getByText('ذخیره شد')).toBeVisible();
    await page.reload();
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
