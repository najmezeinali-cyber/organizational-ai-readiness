import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { domains, questionsFor } from '../lib/content';
import { evaluate } from '../lib/engine';
import { findChromeExecutable, generatePdf, renderReportHtml } from '../lib/pdf';
import type { Answer, Answers, Report } from '../lib/types';

function fixture(answer: Answer = 'unknown'): Report {
  const answers = Object.fromEntries(questionsFor('engineering').map(question => [question.id, answer])) as Answers;
  return evaluate('engineering', 'delay-review', answers);
}

async function hasFont(): Promise<boolean> {
  try { await access(path.join(process.cwd(), 'public/brand/estedad.woff2')); return true; } catch { return false; }
}
async function registerTests() {
const fontAvailable = await hasFont();
let browserAvailable = false;
try { await findChromeExecutable(); browserAvailable = true; } catch { /* Integration is portable to browser-free CI. */ }
const integrationSkip = !fontAvailable ? 'Local Estedad font is not installed.' : !browserAvailable ? 'Chrome is not installed; set CHROME_PATH.' : false;

test('HTML has exactly six explicit RTL A4 pages; anonymous ignores personal name and arbitrary task titles', { skip: !fontAvailable }, async () => {
  const report = fixture();
  const html = await renderReportHtml({ ...report, task: 'PRIVATE COMPANY TITLE' }, { name: '<img src="https://evil.test" onerror="alert(1)">', anonymous: true, demo: true });
  assert.equal((html.match(/<section class="page"/g) ?? []).length, 6);
  assert.equal((html.match(/نمونه نمایشی \/ DEMO — داده‌های کاملاً فرضی/g) ?? []).length, 6);
  assert.match(html, /lang="fa" dir="rtl"/);
  assert.match(html, /@page\{size:A4;margin:0\}/);
  assert.match(html, /data:font\/(?:woff2|ttf);base64,/);
  assert.doesNotMatch(html, /PRIVATE COMPANY TITLE|evil\.test|onerror=|<script|https?:\/\//);
  assert.doesNotMatch(html, /تهیه‌شده برای:/);
  for (const gate of report.gates) assert.ok(html.includes(gate.title), `Missing safety gate: ${gate.title}`);
});

test('all dynamic text is HTML escaped, including names, labels, template text and evidence', { skip: !fontAvailable }, async () => {
  const base = fixture();
  const attack = '<script>fetch("https://evil.test/owner")</script>&\'';
  const report: Report = {
    ...base,
    axes: base.axes.map(axis => ({ ...axis, label: attack, level: attack })),
    gates: base.gates.map(gate => ({ ...gate, title: attack, detail: attack, questionIds: [attack] })),
    blockers: base.blockers.map(item => ({ ...item, title: attack, output: attack, evidence: [attack] })),
    actions: base.actions.map(item => ({ ...item, title: attack, output: attack, done: attack, evidence: [attack] })),
    recommendations: base.recommendations.map(item => ({ ...item, title: attack, reason: attack, description: attack, prerequisite: attack })),
    weeks: base.weeks.map(week => ({ title: attack, days: attack, body: attack, output: attack })),
    prompt: attack, sampleInput: attack, expectedOutput: attack, worksheet: [attack],
  };
  const html = await renderReportHtml(report, { name: attack });
  assert.doesNotMatch(html, /<script>|<img|<iframe/);
  assert.ok(!html.includes(attack));
  assert.ok(html.includes('&lt;script&gt;fetch(&quot;https://evil.test/owner&quot;)&lt;/script&gt;&amp;&#39;'));
});

// PDF.js legacy supplies Node's DOMMatrix/Path2D/ImageData through its optional
// @napi-rs/canvas adapter. Text extraction requires no page rasterization.
async function readPdf(buffer: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: false }).promise;
}
const demoText = 'نمونه نمایشی / DEMO';
const normalized = (text: string) => text.normalize('NFKC').replace(/[\s‌‎‏]/g, '');

test('real PDF: six A4 pages, embedded Persian text, every unknown safety gate visible, no owner metadata', { skip: integrationSkip, timeout: 120_000 }, async () => {
  const report = fixture();
  const buffer = await generatePdf(report, { name: 'PRIVATE-OWNER-UNIQUE', anonymous: true, demo: true });
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  const document = await readPdf(buffer);
  try {
    assert.equal(document.numPages, 6);
    const texts: string[] = [];
    for (let number = 1; number <= 6; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      assert.ok(Math.abs(viewport.width - 595.28) < 1);
      assert.ok(Math.abs(viewport.height - 841.89) < 1);
      const content = await page.getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str : '').join(' ');
      texts.push(text);
      assert.ok(text.includes('DEMO'), `Page ${number} lacks the ASCII demo label`);
      assert.ok(!text.includes('PRIVATE-OWNER-UNIQUE'));
    }
    for (const gate of report.gates) {
      for (const id of gate.questionIds) assert.ok(texts[4].includes(id), `Gate evidence reference missing: ${id}`);
    }
    assert.ok(texts[1].length > 100, 'Page 2 has no extracted content');
    const metadata = await document.getMetadata();
    assert.ok(!JSON.stringify(metadata).includes('PRIVATE-OWNER-UNIQUE'));
    assert.ok(!JSON.stringify(metadata).includes('delay-review'));
  } finally { await document.destroy(); }
});

test('all domains and all-zero/all-three cases still produce six real pages', { skip: integrationSkip, timeout: 180_000 }, async () => {
  for (const domain of domains) {
    for (const answer of [0, 3] as const) {
      const answers = Object.fromEntries(questionsFor(domain.id).map(question => [question.id, answer])) as Answers;
      const report = evaluate(domain.id, domain.tasks[0].id, answers);
      const document = await readPdf(await generatePdf(report));
      try { assert.equal(document.numPages, 6, `${domain.id} / ${answer}`); }
      finally { await document.destroy(); }
    }
  }
});

test('oversized content fails explicitly instead of clipping, and browser slots recover', { skip: integrationSkip, timeout: 120_000 }, async () => {
  const report = fixture(3);
  await assert.rejects(generatePdf({ ...report, prompt: 'متن طولانی '.repeat(20_000) }), /از اندازه A4 بیشتر است/);
  const document = await readPdf(await generatePdf(report));
  try { assert.equal(document.numPages, 6); } finally { await document.destroy(); }
});

test('concurrent generation has a bounded busy response', { skip: integrationSkip, timeout: 120_000 }, async () => {
  const report = fixture(3);
  const first = generatePdf(report);
  const second = generatePdf(report);
  const busy = generatePdf(report);
  // Attach all handlers immediately so an individual job failure cannot become
  // an unhandled rejection while the busy assertion is being checked.
  const jobs = Promise.allSettled([first, second]);
  await assert.rejects(busy, /شلوغ است/);
  const results = await jobs;
  for (const result of results) assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : '');
});
}
void registerTests();
