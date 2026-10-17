import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { domains } from './content';
import type { ActionItem, Report } from './types';

export type PdfOptions = { name?: string; demo?: boolean; anonymous?: boolean };
const MAX_JOBS = 2;
const JOB_TIMEOUT_MS = 45_000;
let activeJobs = 0;

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const fa = (value: number): string => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value);
const paragraph = (value: string, className = '') => `<p class="${className}">${esc(value)}</p>`;
// Keep the cited question and the actual answer, not repeated question prose.
// The full questionnaire remains the source; no safety condition is removed.
const compactEvidence = (value: string): string => value.replace(/([A-Z]\d{2}) — .*? پاسخ: ([^|]+)(?= \| |$)/g, '$1: $2');
const labels: Record<ActionItem['kind'], string> = { barrier: 'نیازمند اقدام', clarification: 'نیازمند روشن‌شدن', improve: 'برای تکمیل', start: 'گام شروع' };

/** Static, script-free HTML. Every model/name string is escaped; resources are embedded. */
export async function renderReportHtml(report: Report, options: PdfOptions = {}): Promise<string> {
  let font: Buffer;
  let fontFormat = 'truetype';
  let fontMime = 'font/ttf';
  try {
    try { font = await readFile(path.join(process.cwd(), 'public', 'brand', 'estedad.ttf')); }
    catch {
      font = await readFile(path.join(process.cwd(), 'public', 'brand', 'estedad.woff2'));
      fontFormat = 'woff2';
      fontMime = 'font/woff2';
    }
  } catch {
    throw new Error('فونت فارسی گزارش در دسترس نیست؛ فایل public/brand/estedad.woff2 را نصب کنید.');
  }
  const domain = domains.find(item => item.id === report.domain);
  const task = domain?.tasks.find(item => item.id === report.task);
  // Never print arbitrary task text: an “other” title can identify a person/company.
  const taskTitle = task?.title ?? 'قالب عمومی، نه راهکار اختصاصی تحلیل‌شده';
  const selected = report.recommendations.find(item => item.recommended);
  const heading = 'خودارزیابی اولیه بر اساس پاسخ‌های شما';
  const notice = report.policyBlocked
    ? 'طبق پاسخ شما، استفاده کاری از ابزار عمومی فعلاً مجاز نیست. فقط آماده‌سازی بدون ابزار عمومی؛ داده ساختگی مجوز دورزدن سیاست شرکت نیست.'
    : report.gates.length
      ? 'تا رفع تمام پیش‌نیازها، اجرای واقعی و استفاده عملی خروجی توصیه نمی‌شود. تمرین با داده ساختگی نیز فقط در حدود سیاست شرکت مجاز است.'
      : 'پیش‌نیازها طبق پاسخ شما روشن‌ترند؛ اجرای محدود فقط در دامنه مجوز، با بازبینی کامل و شرط توقف. این نتیجه مجوز شرکت نیست.';
  const section = (number: number, title: string, body: string) => `<section class="page" aria-label="${esc(title)}" data-page="${number}"><header><span>آمادگی استفاده از هوش مصنوعی</span><span>${options.demo ? 'نمونه نمایشی / DEMO — داده‌های کاملاً فرضی' : 'خودارزیابی اولیه'}</span></header><main class="page-content"><div class="eyebrow">${fa(number)} / ۶</div><h1>${esc(title)}</h1>${body}</main><footer><span>خوداظهاری، نه اندازه‌گیری عملکرد یا تأیید رسمی</span><span>صفحه ${fa(number)} از ۶${options.demo ? ' · نمونه نمایشی' : ''}</span></footer></section>`;
  const action = (item: ActionItem) => `<article class="card"><h3>${esc(item.title)}</h3><span class="tag">${esc(labels[item.kind])}</span>${paragraph(`خروجی: ${item.output}`)}${paragraph(`معیار پایان: ${item.done}`)}${paragraph(`شاهد پاسخ‌ها: ${item.evidence.map(compactEvidence).join('؛ ') || 'گام شروع؛ نه ضعف اثبات‌شده'}`, 'muted small')}</article>`;
  const blockers = report.blockers.slice(0, 3);
  const blockerHtml = blockers.map(item => `<article class="card"><h3>${esc(item.title)}</h3><span class="tag">${esc(labels[item.kind])}</span>${paragraph(`دلیل و شاهد: ${item.evidence.map(compactEvidence).join('؛ ') || 'اطلاعات بیشتری لازم است'}`)}${paragraph(`اثر عملی / خروجی لازم: ${item.output}`)}</article>`).join('') + Array.from({ length: Math.max(0, 3 - blockers.length) }, () => '<p class="muted">مانع دیگری از پاسخ‌های موجود احراز نشد؛ این به معنی تضمین ایمنی یا موفقیت نیست.</p>').join('');
  const rows = report.axes.map(axis => {
    const score = axis.score === null ? null : Math.min(100, Math.max(0, axis.score));
    return `<tr><th scope="row">${esc(axis.label)}</th><td>${score === null ? '<span class="unknown">نامعلوم — اطلاعات کافی نداریم</span>' : `<div class="bar-track" aria-hidden="true"><div class="bar" style="width:${Number.isFinite(score) ? score : 0}%"></div></div><span>${fa(score)} از ۱۰۰</span>`}</td><td>${fa(axis.known)} پاسخ روشن از ۶<br>${fa(Math.max(0, 6 - axis.known))} نامعلوم</td><td>${esc(axis.level)}</td></tr>`;
  }).join('');
  const recommendations = report.recommendations.map(item => {
    const source = domain?.tasks.find(candidate => candidate.id === item.id);
    return `<article class="card option"><h3>${esc(item.title)}${item.recommended ? ' <span class="tag">گزینه پیشنهادی مشروط</span>' : ''}</h3>${paragraph(item.description)}${paragraph(`دلیل: ${item.reason}`)}${paragraph(`پیش‌نیاز: ${item.prerequisite}`)}${source ? `${paragraph(`ورودی لازم: ${source.input}`)}${paragraph(`کنترل انسانی: ${source.control}`)}` : ''}</article>`;
  }).join('');
  const gates = report.gates.map(gate => {
    const detail = compactEvidence(gate.detail);
    const missingReferences = gate.questionIds.filter(id => !detail.includes(id));
    return `<article class="gate"><h3>${esc(gate.title)}</h3>${paragraph(detail)}${missingReferences.length ? paragraph(`سؤال مبنا: ${missingReferences.join('، ')}`, 'small muted') : ''}</article>`;
  }).join('');
  const pages = [
    section(1, 'خلاصه مدیریتی', `<h2>${heading}</h2>${!options.anonymous && options.name?.trim() ? paragraph(`تهیه‌شده برای: ${options.name.trim()}`) : ''}${paragraph(`حوزه: ${domain?.label ?? 'عمومی'} · کار منتخب: ${taskTitle}`)}<div class="lead">این گزارش کمک می‌کند یک کار کوچک، ورودی امن و مسیر قابل بازبینی برای آزمودن استفاده از ابزار مشخص کنید؛ نه وعده تحول یا صرفه‌جویی تضمینی.</div><h2>سناریو و حدود اعتبار</h2>${paragraph(options.demo ? 'همه پاسخ‌ها و مثال‌های این نسخه فرضی و صرفاً برای نمایش شکل خروجی هستند؛ تحلیل واقعی سازمان انجام نشده است.' : 'نتیجه فقط از پاسخ‌های ثبت‌شده شما ساخته شده است. اطلاعات نامعلوم ضعف یا تخلف تلقی نمی‌شود و نتیجه جای ارزیابی تخصصی، مجوز داده یا سیاست شرکت را نمی‌گیرد.')}<div class="warning">${esc(notice)}</div><h2>پیشنهاد اول</h2>${paragraph(report.personalized ? selected?.title ?? 'ابتدا پیش‌نیازها را روشن کنید.' : 'اطلاعات برای توصیه شخصی کافی نیست؛ گزینه انتخابی فقط نقطه بررسی است.')}${selected ? paragraph(selected.reason) + paragraph(`پیش‌نیاز: ${selected.prerequisite}`) : ''}<h2>وعده قابل سنجش، نه عدد ساختگی</h2>${paragraph('زمان پایه: اندازه‌گیری نشده. هیچ درصد صرفه‌جویی یا بازگشت سرمایه از این خودارزیابی محاسبه نشده است. ابتدا زمان کل و کیفیت چند نوبت مشابه و مجاز را ثبت کنید.')}`),
    section(2, 'وضعیت پنج محور', `${paragraph('عددها فقط خلاصه پاسخ‌های روشن‌اند؛ آستانه‌ها قراردادی و اولیه‌اند. نمره کل سازمان و رتبه‌بندی افراد ارائه نمی‌شود.')}<table><thead><tr><th>محور</th><th>وضعیت خوداظهاری</th><th>پوشش پاسخ</th><th>تفسیر</th></tr></thead><tbody>${rows}</tbody></table><h2>موارد نامعلوم چگونه خوانده شوند؟</h2>${paragraph('کمتر از چهار پاسخ عددی در یک محور: اطلاعات کافی برای جمع‌بندی نداریم. خانه خالی برچسب‌دار به معنی صفر نیست. با چهار تا شش پاسخ روشن، عدد فقط از همان پاسخ‌های روشن محاسبه می‌شود.')}${paragraph('میله‌ها یک مقیاس مشترک صفر تا صد دارند؛ طول میله، نه تفاوت رنگ، مقدار را نشان می‌دهد. متن و جدول مرجع خواندن نتیجه‌اند. حتی عدد ۱۰۰ تأیید عملکرد یا مجوز اجرا نیست.')}<div class="warning">${esc(notice)}</div>`),
    section(3, 'موانع و اقدام‌های اولویت‌دار', `<h2>سه مانع یا موضوع نیازمند بررسی</h2>${blockerHtml}<h2>سه اقدام اولویت‌دار</h2>${report.actions.slice(0, 3).map(action).join('')}${paragraph('ترتیب اقدام‌ها با قواعد روشن مجوز، داده و بازبینی تعیین شده است. محدودشدن این فهرست به سه مورد، سایر گیت‌های صفحه پنجم را حذف نمی‌کند.', 'small muted')}`),
    section(4, 'کاربردهای پیشنهادی و روش اجرا', `${paragraph(report.personalized ? 'توصیه مشروط بر پاسخ‌های همین ارزیابی است؛ رتبه داخلی، احتمال موفقیت یا درصد آمادگی نیست.' : 'اطلاعات برای توصیه شخصی کافی نیست؛ این فهرست گزینه‌های بررسی و آماده‌سازی است، نه توصیه اجرای واقعی.')}${recommendations}<h2>روش مستقل اجرای محدود</h2>${paragraph('هدف و مرز ← ورودی ساختگی/عمومی غیرحساس و مجاز ← پیش‌نویس با قالب زیر ← تطبیق با منبع و بازبینی فرد صلاحیت‌دار ← استفاده فقط پس از تأیید. برای صورت‌جلسه ابتدا وجود یادداشت مجاز تأیید شود.')}<h3>دستور آماده تمرین</h3>${paragraph(report.prompt, 'template')}${paragraph('علت تأخیر، مسئول اقدام، موعد یا تصمیم ناموجود را اختراع نکنید؛ آن را «نامعلوم / نیازمند تأیید» بنویسید. پیش‌نویس مجوز تصمیم یا ارسال نیست.', 'small')}`),
    section(5, 'برنامه چهار هفته‌ای و تمام گیت‌های ایمنی', `${paragraph('روزها پیشنهادند، نه الزام یا وعده. اگر گیت‌ها رفع نشوند، برنامه در آماده‌سازی می‌ماند؛ پایان روز سی‌ام می‌تواند تصمیم به توقف باشد.', 'small')}<div class="weeks">${report.weeks.map(week => `<article class="card"><h3>${esc(week.title)} · ${esc(week.days)}</h3>${paragraph(week.body)}${paragraph(`خروجی / شرط عبور: ${week.output}`)}</article>`).join('')}</div><h2>پیش از اجرا — همه شروط باز، بدون حذف</h2>${gates || '<p>گیت باز از پاسخ‌های موجود احراز نشد؛ رعایت مجوز داده، سیاست شرکت و بازبینی انسانی همچنان الزامی است.</p>'}<div class="warning">${esc(notice)}</div>`),
    section(6, 'برگه زمان و کیفیت و شروع مستقل', `<h2>خط پایه: اندازه‌گیری نشده</h2>${paragraph('این برگه خالی است؛ تاریخ و نام مسئول را فقط در محیط خصوصی خودتان ثبت کنید. داده‌ای از مالک حساب در این خروجی درج نشده است.', 'small')}<table class="worksheet"><tbody>${report.worksheet.map(field => `<tr><th>${esc(field)}</th><td>ثبت نشده / نیازمند اندازه‌گیری</td></tr>`).join('')}</tbody></table>${paragraph('زمان کل = جمع‌آوری + آماده‌سازی + استفاده از ابزار + بازبینی و اصلاح. حجم و پیچیدگی نمونه، نوع نمونه (ساختگی / واقعی مجاز)، خطاهای مهم و تصمیم استفاده یا رد را ثبت کنید.', 'small')}<h3>کیفیت: برای هر معیار «برآورده شد / نشد / قابل سنجش نبود»</h3>${paragraph('صحت نسبت به منبع؛ کامل‌بودن اقلام ضروری؛ قابلیت پیگیری منبع؛ روشن‌بودن موارد نامعلوم و اقدام. خروجی بدون بازبین و تأیید فرد مجاز منتشر نشود.', 'small')}${paragraph('درصد تغییر زمان فقط با خط پایه مثبت، اندازه‌گیری معتبر و نمونه‌های قابل مقایسه: (زمان پایه − زمان با ابزار) ÷ زمان پایه × ۱۰۰. مقدار منفی یعنی زمان بیشتر؛ یک نوبت اثبات صرفه‌جویی پایدار نیست.', 'small')}<h2>شروع مستقل با نمونه امن</h2><h3>ورودی ساختگی / غیرحساس</h3>${paragraph(report.sampleInput, 'template small')}<h3>خروجی مورد انتظار</h3>${paragraph(report.expectedOutput, 'template small')}${paragraph('از دستور صفحه چهارم و چک‌لیست صفحه پنجم استفاده کنید؛ دو تمرین مجاز را بازبینی و خطاها را ثبت کنید. نتیجه منفی یا نامعلوم را پنهان نکنید. هیچ ورودی یا راهنمای ضروری به خرید مشاوره وابسته نیست.', 'small')}<h3>همراهی اختیاری</h3>${paragraph('اگر برای شخصی‌سازی این مسیر یا گسترش آن به چند فرایند به همراهی نیاز دارید، می‌توانید درخواست جلسه بدهید. شروع مستقل با همین راهنما ممکن است و مشاوره الزامی نیست.', 'small')}`),
  ];
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'"><title>گزارش خودارزیابی اولیه</title><style>
@font-face{font-family:Estedad;src:url(data:${fontMime};base64,${font.toString('base64')}) format('${fontFormat}');font-weight:100 900;font-display:block}
@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#F4F1EA;color:#252A2B;font-family:Estedad,sans-serif;font-size:10pt;line-height:1.75;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:210mm;height:297mm;padding:12mm 14mm 11mm;display:flex;flex-direction:column;break-after:page;page-break-after:always;background:#FCFBF8}.page:last-child{break-after:auto;page-break-after:auto}header,footer{display:flex;justify-content:space-between;gap:5mm;color:#64716B;font-size:8pt;flex-shrink:0}header{border-bottom:1px solid #DCD8CE;padding-bottom:3mm;margin-bottom:4mm}footer{margin-top:auto;border-top:1px solid #DCD8CE;padding-top:2.5mm}.page-content{flex:1;min-height:0;padding-bottom:4mm;--body-size:10pt;font-size:var(--body-size);overflow:visible}h1{font-size:23pt;line-height:1.5;color:#0E2F32;margin:0 0 5mm}h2{font-size:1.22em;color:#143F43;margin:4mm 0 2mm}h3{font-size:1.03em;line-height:1.65;color:#143F43;margin:0 0 1mm}p{margin:1.4mm 0;white-space:pre-wrap;overflow-wrap:anywhere}.eyebrow{font-size:8pt;color:#7F5237}.lead{font-size:1.2em;border-right:3px solid #B77A55;padding:3mm 4mm;margin:4mm 0}.card{border:1px solid #DCD8CE;border-radius:2mm;padding:2.2mm 3mm;margin:2mm 0;break-inside:avoid}.card p{margin:1mm 0}.tag{font-size:.83em;color:#7F5237;font-weight:650}.muted{color:#64716B}.small{font-size:.86em}.warning{border:1px solid #8F2F27;border-right:3px solid #8F2F27;color:#8F2F27;padding:3mm;margin:3mm 0;font-size:.94em;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:3mm 0;font-size:.93em}th,td{text-align:right;vertical-align:top;border-bottom:1px solid #DCD8CE;padding:3mm 2mm;overflow-wrap:anywhere}thead{background:#F4F1EA;color:#0E2F32}th{font-weight:650}.bar-track{height:2.5mm;background:#F4F1EA;width:100%;margin:1mm 0;direction:ltr}.bar{height:100%;background:#143F43;border-radius:0 1mm 1mm 0}.unknown{display:block;border:1px dashed #64716B;padding:2mm;font-size:.9em}.gate{border-right:2px solid #B77A55;padding:1mm 3mm;margin:1.5mm 0;break-inside:avoid}.gate p{margin:.7mm 0}.template{background:#F4F1EA;border:1px solid #DCD8CE;padding:2mm 3mm;font-size:.9em}.worksheet th,.worksheet td{padding:1.1mm 2mm}.worksheet th{width:62%}.weeks .card{padding:1.8mm 3mm}.option{padding:2mm 3mm}.page[data-page="3"] .page-content,.page[data-page="4"] .page-content,.page[data-page="5"] .page-content,.page[data-page="6"] .page-content{--body-size:9.2pt}
.page-content{line-height:1.6}.small{line-height:1.55}.worksheet{font-size:.85em}.worksheet th{width:86%;font-weight:450}.worksheet td{font-size:.8em}.page[data-page="5"] .page-content{line-height:1.48}.page[data-page="5"] .card,.page[data-page="5"] .gate{margin:1.2mm 0;padding-top:1mm;padding-bottom:1mm}.page[data-page="6"] h2{margin:2.5mm 0 1mm}.page[data-page="6"] h3{margin:1.5mm 0 .5mm}
</style></head><body>${pages.join('')}</body></html>`;
}

export async function findChromeExecutable(): Promise<string> {
  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* Try the next local installation. */ }
  }
  throw new Error('مرورگر تولید PDF در دسترس نیست؛ Chrome را نصب یا CHROME_PATH را تنظیم کنید.');
}

/** Node-only; one isolated browser per job and a bounded number of simultaneous jobs. */
export async function generatePdf(report: Report, options: PdfOptions = {}): Promise<Buffer> {
  if (activeJobs >= MAX_JOBS) throw new Error('تولید گزارش PDF شلوغ است؛ چند لحظه دیگر دوباره تلاش کنید.');
  activeJobs++;
  let browser: Browser | undefined;
  let expired = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { expired = true; reject(new Error('زمان تولید PDF به پایان رسید؛ دوباره تلاش کنید.')); }, JOB_TIMEOUT_MS);
  });
  const bounded = <T>(operation: Promise<T>) => Promise.race([operation, deadline]);
  try {
    const executablePath = await bounded(findChromeExecutable());
    const html = await bounded(renderReportHtml(report, options));
    const launch = puppeteer.launch({ executablePath, headless: true, timeout: 15_000, protocolTimeout: 20_000, args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
    // If launch finishes after the overall deadline, do not leave an orphan browser.
    void launch.then(lateBrowser => { if (expired) void lateBrowser.close().catch(() => lateBrowser.process()?.kill()); }, () => undefined);
    browser = await bounded(launch);
    const page = await bounded(browser.newPage());
    await bounded(page.setJavaScriptEnabled(false));
    await bounded(page.setRequestInterception(true));
    page.on('request', request => {
      // No HTTP(S), file URLs, localhost, or other external resources, even if a
      // future template accidentally adds one. Only embedded font/image data.
      void (request.url().startsWith('data:') || request.url() === 'about:blank' ? request.continue() : request.abort()).catch(() => undefined);
    });
    await bounded(page.emulateMediaType('print'));
    await bounded(page.setContent(html, { waitUntil: 'load', timeout: 15_000 }));
    const overflows = await bounded(page.evaluate(async () => {
      await document.fonts.ready;
      if (!document.fonts.check('12px Estedad')) throw new Error('فونت فارسی گزارش بارگذاری نشد.');
      const failures: number[] = [];
      for (const section of Array.from(document.querySelectorAll<HTMLElement>('.page'))) {
        const content = section.querySelector<HTMLElement>('.page-content')!;
        const footer = section.querySelector<HTMLElement>('footer')!;
        // Measure actual layout after font readiness. Never hide overflow or
        // omit gates. Modest per-page typography tightening is the only fallback.
        const base = parseFloat(getComputedStyle(content).fontSize);
        let fitted = false;
        for (const scale of [1, .96, .92, .88]) {
          content.style.fontSize = `${base * scale}px`;
          const bottom = footer.getBoundingClientRect().top - 8;
          const children = Array.from(content.children);
          fitted = content.scrollWidth <= content.clientWidth + 1 && children.every(child => child.getBoundingClientRect().bottom <= bottom + 1) && section.scrollHeight <= section.clientHeight + 1;
          if (fitted) break;
        }
        if (!fitted) failures.push(Number(section.dataset.page));
      }
      return failures;
    }));
    if (overflows.length) throw new Error(`محتوای گزارش در صفحه‌های ${overflows.map(fa).join('، ')} از اندازه A4 بیشتر است؛ متن را کوتاه‌تر کنید. هیچ محتوایی حذف نشد.`);
    const bytes = await bounded(page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, tagged: true, margin: { top: 0, bottom: 0, left: 0, right: 0 }, timeout: 20_000 }));
    return Buffer.from(bytes);
  } finally {
    if (timeout) clearTimeout(timeout);
    try {
      if (browser) {
        const current = browser;
        let closeTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([current.close(), new Promise<void>(resolve => { closeTimer = setTimeout(() => { current.process()?.kill(); resolve(); }, 5_000); })]);
        } catch { current.process()?.kill(); }
        finally { if (closeTimer) clearTimeout(closeTimer); }
      }
    } finally { activeJobs--; }
  }
}
