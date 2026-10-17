import { actionLibrary, axes, contentVersion, domains, questionsFor } from './content';
import type { ActionItem, Answer, Answers, Domain, Gate, Question, Recommendation, Report, Task } from './types';

export function validateAnswers(domain: Domain, answers: Answers, complete = false): void {
  const questions = questionsFor(domain);
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(answers))) {
    throw new Error('پاسخ‌ها باید یک نگاشت معتبر باشند.');
  }
  const ids = new Set(questions.map(q => q.id));
  for (const key of Reflect.ownKeys(answers)) {
    if (typeof key !== 'string' || !ids.has(key)) throw new Error('شناسه سؤال نامعتبر یا خارج از مسیر است.');
    const descriptor = Object.getOwnPropertyDescriptor(answers, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || ![0, 1, 2, 3, 'unknown'].includes(descriptor.value)) {
      throw new Error(`پاسخ ${key} نامعتبر است.`);
    }
  }
  if (complete && questions.some(q => !Object.hasOwn(answers, q.id))) throw new Error('برای گزارش، پاسخ هر ۳۰ سؤال لازم است.');
}

type Event = { actionId: string; priority: number; severity: number; order: number; question: Question; answer: Answer };
const severity = (answer: Answer) => answer === 'unknown' ? 2 : ({ 0: 0, 1: 1, 2: 3, 3: 4 })[answer];
const lessThan = (answer: Answer, threshold: number) => answer === 'unknown' || answer < threshold;
const atLeast = (answer: Answer, threshold: number) => answer !== 'unknown' && answer >= threshold;
const compareEvents = (a: Event, b: Event) => a.priority - b.priority || a.severity - b.severity || a.order - b.order;
const unknownLabel = 'نمی‌دانم / هنوز بررسی نکرده‌ام';

function evidence(question: Question, answer: Answer): string {
  return `${question.id} — ${question.text} پاسخ: ${answer === 'unknown' ? unknownLabel : question.options[answer]}`;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function recommendationList(domain: Domain, task: string, answers: Answers, prefix: string, gates: Gate[], personalized: boolean): Recommendation[] {
  const generic: Task[] = [
    { id: 'organize', title: 'مرتب‌سازی اطلاعات موجود', description: 'قالب عمومی، نه راهکار اختصاصی تحلیل‌شده؛ جدول اطلاعات موجود، منبع و موارد نامعلوم.', input: 'متن یا جدول مشخص و ساختگی', control: 'منبع و صحت هر ردیف را بازبین بررسی کند.' },
    { id: 'draft', title: 'پیش‌نویس بر اساس ورودی مشخص', description: 'قالب عمومی، نه راهکار اختصاصی تحلیل‌شده؛ پیش‌نویس محدود به ورودی و قالب تعیین‌شده.', input: 'ورودی ساختگی و قالب خروجی روشن', control: 'بازبین صلاحیت‌دار پیش‌نویس را تأیید یا رد کند.' },
    { id: 'extract-actions', title: 'استخراج اقدامات از یادداشت', description: 'قالب عمومی، نه راهکار اختصاصی تحلیل‌شده؛ اقدام توافق‌شده از پیشنهاد و موضوع باز جدا شود.', input: 'ابتدا وجود یادداشت مجاز تأیید شود', control: 'مسئول و موعد ناموجود «نیازمند تعیین» بماند.' },
  ];
  const defaults = domain === 'engineering' ? ['delay-review', 'minutes', 'weekly-report'] : domain === 'procurement' ? ['purchase-tracking', 'minutes', 'comparison'] : ['issues', 'minutes', 'status-report'];
  const tasks = task === 'other' ? generic : defaults.map(id => domains.find(d => d.id === domain)!.tasks.find(t => t.id === id)!);
  const scored = tasks.map((candidate, order) => {
    let score = 0;
    const reasons: string[] = [];
    const add = (points: number, reason: string) => { score += points; reasons.push(reason); };
    if (candidate.id === task) add(3, 'این کار را برای بررسی انتخاب کرده‌اید (+۳).');
    if (atLeast(answers.G02, 2) && atLeast(answers.G05, 2)) add(1, 'G02 و G05: امکان تکرار و محدودکردن تمرین گزارش شده است (+۱).');
    const notes = candidate.id === 'minutes' || candidate.id === 'extract-actions';
    if (!notes && atLeast(answers.D01, 2) && atLeast(answers.D02, 2)) add(2, 'D01 و D02: دسترسی و قالب ورودی نسبتاً روشن است (+۲).');
    if (atLeast(answers.F01, 2) && atLeast(answers.F03, 2)) add(1, 'F01 و F03: مراحل و مسئول بازبینی گزارش شده است (+۱).');
    if (task !== 'other' && !notes && atLeast(answers[`${prefix}02`], 2) && atLeast(answers[`${prefix}03`], 2)) add(2, `${prefix}02 و ${prefix}03: کنترل تخصصی ورودی گزارش شده است (+۲).`);
    const eligible = !(candidate.id === 'comparison' && lessThan(answers.P02, 2));
    const prerequisites = [
      gates.length ? 'فقط پیشنهاد برای تمرین پس از رفع پیش‌نیازها؛ اجرای واقعی یا انتشار فعلاً توصیه نمی‌شود.' : 'فقط اجرای محدود، در دامنه مجوز خوداظهارشده و با بازبینی کامل؛ این گزارش مجوز شرکت نیست.',
      answers.R03 === 2 ? 'داده واقعی فقط در دامنه صریح مجوز، ابزار و شرایط تأییدشده؛ نه همه داده‌ها.' : '',
      notes ? 'ابتدا وجود یادداشت مجاز را تأیید کنید؛ پرسش‌نامه وجود آن را ثابت نمی‌کند.' : '',
      eligible ? '' : 'نیازمند آماده‌سازی ورودی: P02؛ ابتدا تعریف‌ها، واحدها و شرایط را یکسان کنید.',
      answers.R02 === 0 ? 'استفاده کاری از ابزار عمومی فعلاً مجاز نیست؛ حتی با داده ساختگی ممنوعیت را دور نزنید.' : '',
      `ورودی لازم: ${candidate.input}. کنترل انسانی: ${candidate.control}`,
    ].filter(Boolean).join(' ');
    return { candidate, order, score, eligible, reasons, prerequisites };
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const winner = personalized ? scored.find(item => item.eligible && item.reasons.length > 0) : undefined;
  return scored.map(item => ({
    id: item.candidate.id, title: item.candidate.title,
    description: item.candidate.description,
    reason: personalized ? item.reasons.join(' ') || 'شاهد کافی برای ترجیح این گزینه وجود ندارد؛ ترتیب پیش‌فرض دلیل توصیه نیست.' : 'اطلاعات برای توصیه شخصی کافی نیست؛ گزینه انتخابی فقط نقطه بررسی است و رتبه‌بندی شخصی ارائه نمی‌شود.',
    rank: personalized ? item.score : 0,
    recommended: item === winner,
    prerequisite: item.prerequisites,
  }));
}

function practice(domain: Domain, task: string, policyBlocked: boolean, prerequisiteOpen: boolean): Pick<Report, 'prompt' | 'sampleInput' | 'expectedOutput' | 'worksheet'> {
  const generic = task === 'other';
  const minutes = task === 'minutes';
  let sampleInput: string;
  let expectedOutput: string;
  let job: string;
  if (generic) {
    job = 'قالب عمومی، نه راهکار اختصاصی تحلیل‌شده. یکی از سه الگو را انتخاب کن: مرتب‌سازی اطلاعات موجود، پیش‌نویس بر اساس ورودی مشخص، استخراج اقدامات از یادداشت. خروجی را به ورودی و مرز اعلام‌شده محدود کن.';
    sampleInput = 'نمونه کاملاً ساختگی؛ تاریخ مبنا: روز ۷.\nردیف الف | وضعیت: باز | منبع: یادداشت ساختگی ۱ | اقدام توافق‌شده: بررسی ورودی | مسئول: نقش الف | موعد: ناموجود\nردیف ب | وضعیت: نیازمند توضیح | منبع: جدول ساختگی ۲ | علت: ناموجود | اقدام توافق‌شده: ناموجود';
    expectedOutput = 'مرتب‌سازی: ردیف الف باز؛ ردیف ب نیازمند توضیح.\nپیش‌نویس: دو مورد ثبت شده؛ علت ردیف ب نامعلوم است.\nاقدامات: بررسی ورودی، مسئول نقش الف، موعد نیازمند تعیین. برای ردیف ب اقدام توافق‌شده ثبت نشده؛ سؤال پیگیری: توضیح تأییدشده چیست؟';
  } else if (minutes) {
    job = 'از یادداشت، تصمیم قطعی، اقدام توافق‌شده و موضوع باز را جدا کن؛ پیشنهاد را تصمیم نشان نده.';
    sampleInput = `یادداشت کاملاً ساختگی جلسه ${domain === 'engineering' ? 'هماهنگی مدارک' : domain === 'procurement' ? 'پیگیری خرید' : 'هماهنگی پروژه'}؛ روز ۷.\nتصمیم تأییدشده: جدول وضعیت پیش از جلسه بعد بررسی شود.\nاقدام توافق‌شده: نقش الف فهرست موارد ناقص را آماده کند؛ موعد ذکر نشده.\nپیشنهاد بررسی‌نشده: جلسه دیگری برگزار شود.\nموضوع باز: منبع آخرین وضعیت ردیف ب مشخص نیست.`;
    expectedOutput = 'پیش‌نویس داخلی — نیازمند تأیید\nتصمیم: بررسی جدول وضعیت پیش از جلسه بعد.\nاقدام: تهیه فهرست موارد ناقص | مسئول: نقش الف | موعد: نیازمند تعیین.\nپیشنهاد، نه تصمیم: برگزاری جلسه دیگر.\nموضوع باز: منبع آخرین وضعیت ردیف ب نیازمند تأیید. هیچ موعد یا مسئول جدیدی ساخته نشده است.';
  } else if (domain === 'engineering') {
    job = task === 'weekly-report' ? 'پیش‌نویس گزارش هفتگی وضعیت مدارک را با منبع و موارد نامعلوم بنویس.' : 'مرور هفتگی وضعیت و تأخیر مدارک را تهیه کن؛ جدول تأخیر علت را اثبات نمی‌کند.';
    sampleInput = 'جدول کاملاً ساختگی؛ تاریخ مبنا: روز ۷؛ نسخه: تمرین ۱.\nمدرک الف | موعد مبنا: روز ۴ | وضعیت: باز | مرجع: جدول ساختگی ۱ | توضیح تأییدشده: ناموجود\nمدرک ب | موعد مبنا: روز ۹ | وضعیت: در بررسی | مرجع: جدول ساختگی ۱ | توضیح تأییدشده: در بررسی نقش ب';
    expectedOutput = 'پیش‌نویس داخلی؛ مبنا روز ۷، نسخه تمرین ۱.\nمدرک الف: موعد مبنا گذشته و وضعیت باز است؛ علت ثبت نشده و نیازمند توضیح مرجع مسئول است. سؤال پیگیری: توضیح تأییدشده و منبع آن چیست؟\nمدرک ب: در بررسی، موعد مبنا هنوز نرسیده؛ توضیح ثبت‌شده «در بررسی نقش ب». منبع هر دو: جدول ساختگی ۱. از وضعیت هیچ علت فنی یا تعهد جدیدی استنتاج نشده است.';
  } else if (domain === 'procurement' && task === 'comparison') {
    job = 'فقط خلاصه مقایسه غیرقیمتی تهیه کن؛ تفاوت مبناها را مشخص و از رتبه‌بندی فروشنده یا تصمیم خرید خودداری کن.';
    sampleInput = 'جدول کاملاً ساختگی و غیرقیمتی.\nپیشنهاد الف | دامنه: قلم تمرینی یکسان | تحویل: ۱۰ روز از تأیید درخواست | واحد: روز تقویمی | مرجع: متن ساختگی الف\nپیشنهاد ب | دامنه: قلم تمرینی یکسان | تحویل: ۸ روز | مبنای شروع: ناموجود | واحد: نامعلوم | مرجع: متن ساختگی ب';
    expectedOutput = 'پیش‌نویس مقایسه غیرقیمتی: دامنه دو پیشنهاد یکسان ثبت شده است. الف: ۱۰ روز تقویمی از تأیید درخواست. ب: ۸ روز با واحد و مبنای شروع نامعلوم. موعدها مستقیماً قابل مقایسه نیستند. سؤال پیگیری: واحد و مبنای شروع ب چیست؟ هیچ انتخاب فروشنده، برتری قطعی، قیمت یا تعهدی پیشنهاد نشده است.';
  } else if (domain === 'procurement') {
    job = 'وضعیت پیگیری خرید را با تاریخ و مرجع خلاصه کن؛ وعده را موعد تأییدشده فرض نکن.';
    sampleInput = 'جدول کاملاً ساختگی؛ تاریخ مبنا: روز ۷؛ بدون قیمت و قرارداد واقعی.\nدرخواست الف | وضعیت: منتظر پاسخ | مرجع: مکاتبه ساختگی ۱، روز ۶ | موعد تأییدشده: ناموجود | یادداشت: وعده پاسخ در روز ۹\nدرخواست ب | وضعیت: دریافت پاسخ | مرجع: مکاتبه ساختگی ۲، روز ۷ | اقدام توافق‌شده: بررسی پاسخ توسط نقش ب | موعد: ناموجود';
    expectedOutput = 'پیش‌نویس پیگیری: الف منتظر پاسخ، مرجع مکاتبه ساختگی ۱؛ روز ۹ صرفاً وعده پاسخ است، نه موعد تأییدشده تحویل. سؤال پیگیری: موعد معتبر و مرجع تأیید چیست؟ ب پاسخ دریافت شده، مرجع مکاتبه ساختگی ۲؛ اقدام ثبت‌شده بررسی پاسخ توسط نقش ب؛ موعد نیازمند تعیین. هیچ تعهد پرداخت، قیمت یا موعد تحویل ساخته نشده است.';
  } else {
    job = task === 'status-report' ? 'پیش‌نویس وضعیت هفتگی پروژه را با تاریخ مبنا و منبع بنویس؛ اطلاعات دوره‌های متفاوت را ادغام نکن.' : 'مسائل باز برای جلسه را خلاصه کن؛ تصمیم و اقدام تأییدشده را از موضوع باز جدا کن.';
    sampleInput = 'جدول کاملاً ساختگی؛ تاریخ مبنا: روز ۷.\nمسئله الف | وضعیت: باز | منبع: ثبت ساختگی ۱، روز ۷ | صاحب اطلاعات: نقش الف | تصمیم: ناموجود | اقدام توافق‌شده: جمع‌آوری توضیح | موعد: ناموجود\nمسئله ب | وضعیت: رفع‌شده طبق ثبت | منبع: ثبت ساختگی ۲، روز ۵ | تاریخ به‌روزرسانی جدید: ناموجود';
    expectedOutput = 'پیش‌نویس داخلی با مبنای روز ۷: الف باز است، منبع ثبت ساختگی ۱؛ تصمیم هنوز ثبت نشده؛ اقدام توافق‌شده جمع‌آوری توضیح با صاحب اطلاعات نقش الف؛ موعد نیازمند تعیین. ب در ثبت روز ۵ رفع‌شده است؛ وضعیت روز ۷ نیازمند تأیید است و نباید هم‌زمان فرض شود. هیچ علت، درصد پیشرفت، وعده پایان، هزینه یا تصمیم جدیدی ساخته نشده است.';
  }
  const guard = policyBlocked
    ? 'این قالب فعلاً فقط برای آماده‌سازی بدون ابزار عمومی است. استفاده کاری از ابزار عمومی مجاز نیست یا هنوز تأیید نشده؛ حتی داده ساختگی مجوز دورزدن سیاست شرکت نیست. پس از رفع گیت مجوز و فقط در حدود سیاست شرکت قابل بررسی است.'
    : prerequisiteOpen ? 'این قالب فقط برای تمرین مجاز پس از آماده‌سازی نمونه امن است؛ تا رفع همه پیش‌نیازها خروجی عملی یا انتشار توصیه نمی‌شود.' : 'این قالب برای تمرین با داده کاملاً ساختگی است؛ استفاده واقعی فقط در دامنه مجوز ثبت‌شده و با بازبینی کامل.';
  return {
    prompt: `${guard}\n${job}\nفقط از ورودی استفاده کن. اطلاعات، علت، عدد، مسئول، موعد، تصمیم و تعهد ناموجود نساز؛ «نامعلوم / نیازمند تعیین» بنویس. منبع و تاریخ هر مورد را حفظ کن و اختلاف نسخه را جدا نشان بده. خروجی شامل خلاصه، جدول موارد، اطلاعات ناقص و سؤال پیگیری باشد. همه خروجی‌ها «پیش‌نویس داخلی — نیازمند تأیید» هستند. خروجی مجوز تأیید فنی، انتخاب فروشنده، تعهد قراردادی یا ارسال بیرونی نیست. هیچ سند واقعی، مشخصات شخصی، قیمت یا قرارداد محرمانه در نمونه وارد نکن.`,
    sampleInput, expectedOutput,
    worksheet: [
      'تاریخ اجرا؛ حوزه و کار منتخب؛ نوع نمونه: ساختگی / عمومی غیرحساس / واقعی صریحاً مجاز؛ وضعیت مجوز ابزار و داده و مرجع تأیید را فقط در محیط خصوصی خود ثبت کنید.',
      'حجم و پیچیدگی نمونه، تاریخ مبنا، نسخه و منبع ورودی؛ موارد نامعلوم و شرط مقایسه با خط پایه را ثبت کنید.',
      'خط پایه روش معمول: زمان جمع‌آوری + آماده‌سازی + انجام کار + بازبینی/اصلاح = زمان کل؛ کیفیت خط پایه را جدا ثبت کنید.',
      'نوبت کمکی: زمان جمع‌آوری، زمان آماده‌سازی، زمان استفاده از ابزار، زمان بازبینی/اصلاح و زمان کل را جدا ثبت کنید؛ تعداد خطاهای مهم را بنویسید.',
      'کیفیت: صحت نسبت به منبع؛ کامل‌بودن اقلام ضروری؛ قابلیت پیگیری منبع؛ روشن‌بودن موارد نامعلوم/اقدام. برای هرکدام: برآورده شد / نشد / قابل سنجش نبود.',
      'بازبین صلاحیت‌دار، چک‌لیست، خطای غیرقابل قبول، شرط توقف و روش دستی جایگزین را مشخص کنید؛ تصمیم استفاده یا رد خروجی و دلیل را ثبت کنید.',
      'حداقل دو تمرین ساختگی بررسی‌شده؛ سپس فقط با رفع همه پیش‌نیازها چند نوبت مشابه مجاز را مقایسه کنید. نتیجه نامعلوم یا منفی نیز معتبر است.',
      'درصد تغییر زمان فقط با خط پایه مثبت، اندازه‌گیری معتبر و نمونه‌های قابل مقایسه: (زمان پایه − زمان کمکی) ÷ زمان پایه × ۱۰۰. مقدار منفی یعنی زمان بیشتر؛ خط پایه صفر/نامعلوم یا نمونه نامقایسه‌پذیر هیچ درصدی ندارد. یک نوبت اثبات صرفه‌جویی پایدار نیست.',
      'روز ۳۰: شواهد زمان و کیفیت، خطاها و محدودیت‌ها را مرور و تصمیم ادامه / اصلاح / توقف را ثبت کنید؛ امتیاز خودارزیابی جای سنجش عملکرد نیست.',
    ],
  };
}

export function evaluate(domain: Domain, task: string, answers: Answers): Report {
  validateAnswers(domain, answers, true);
  const info = domains.find(d => d.id === domain)!;
  if (!info.tasks.some(t => t.id === task)) throw new Error('کار منتخب برای این حوزه نامعتبر است.');
  const snapshot: Answers = { ...answers };
  const questions = questionsFor(domain);
  const prefix = { engineering: 'E', procurement: 'P', project: 'M' }[domain];
  const gates: Gate[] = [];
  const events: Event[] = [];
  const byId = new Map(questions.map((q, order) => [q.id, { q, order }]));
  const addEvent = (id: string, priority: number, actionId?: string) => {
    const { q, order } = byId.get(id)!;
    events.push({ actionId: actionId ?? q.actionId, priority, severity: severity(snapshot[id]), order, question: q, answer: snapshot[id] });
  };
  const gate = (id: string, title: string, detail: string, ids: string[], actionId: string, priority: number) => {
    if (!ids.length) return;
    const status = ids.every(key => snapshot[key] === 'unknown') ? 'نیازمند روشن‌شدن' : 'نیازمند اقدام / روشن‌شدن';
    gates.push({ id, title: `${title} — ${status}`, detail: `${detail} ${ids.map(key => evidence(byId.get(key)!.q, snapshot[key])).join(' | ')}`, questionIds: [...ids], actionId });
    ids.forEach(key => addEvent(key, priority, actionId));
  };
  gate('GATE-POLICY', 'مجوز استفاده کاری', snapshot.R02 === 0
    ? 'طبق پاسخ شما، استفاده کاری از ابزار عمومی فعلاً مجاز نیست. حتی داده ساختگی نباید ممنوعیت استفاده کاری را دور بزند؛ ابتدا مجوز یا روش مورد تأیید شرکت روشن شود.'
    : 'قبل از استفاده کاری، حدود اختیار و قاعده استفاده تأیید شود. فعلاً فقط آماده‌سازی بدون ابزار عمومی؛ تمرین آموزشی مستقل نیز فقط در حدود مجاز سیاست شرکت.',
    ['R01', 'R02'].filter(id => id === 'R01' ? lessThan(snapshot[id], 2) : snapshot[id] !== 3), 'A09', 0);
  gate('GATE-DATA', 'مجوز و حساسیت داده', 'ورود داده واقعی توصیه نمی‌شود؛ حذف نام‌ها به‌تنهایی کافی نیست. نمونه پیش‌فرض کاملاً ساختگی یا عمومیِ غیرحساس است.',
    ['D04', 'R03'].filter(id => id === 'D04' ? snapshot[id] !== 3 : lessThan(snapshot[id], 2)), 'A04', 1);
  gate('GATE-SAMPLE', 'آماده‌سازی نمونه امن', 'نمونه امن ابتدا آماده شود؛ تا آن زمان تمرین آغاز نشود. آماده‌بودن نمونه، مجوز داده واقعی نیست.', lessThan(snapshot.D05, 2) ? ['D05'] : [], 'A04', 1);
  gate('GATE-REVIEW', 'بازبینی انسانی', 'استفاده عملی خروجی تا تعیین بازبین صلاحیت‌دار و کنترل صحت توصیه نمی‌شود؛ نامعلوم بودن پاسخ اثبات نبود بازبین نیست.',
    ['F03', 'H03', `${prefix}04`].filter(id => lessThan(snapshot[id], 2)), 'A06', 2);
  gate('GATE-BOUNDARY', 'مرز تصمیم و انتشار', 'ابتدا مرز تصمیم تخصصی/تجاری و انتشار مشخص شود؛ خروجی فقط پیش‌نویس داخلی است و مجوز تصمیم، تعهد یا ارسال نیست.',
    [`${prefix}05`, `${prefix}06`].filter(id => lessThan(snapshot[id], 2)), 'A12', 2);
  // Additional practical prerequisites follow the main safety gates, without outranking them.
  gate('PREREQ-SCOPE', 'محدوده آزمایش', 'پیش از اجرای واقعی یک نمونه، خروجی، مسئول و شرط توقف را محدود و روشن کنید.', lessThan(snapshot.G05, 2) ? ['G05'] : [], 'A01', snapshot.G05 === 'unknown' ? 4 : 3);
  gate('PREREQ-STOP', 'خطا و توقف', 'پیش از استفاده عملی خطای غیرقابل قبول، شرط توقف و روش دستی جایگزین را تعیین کنید.', lessThan(snapshot.F05, 2) ? ['F05'] : [], 'A06', snapshot.F05 === 'unknown' ? 4 : 3);
  for (const question of questions) {
    const answer = snapshot[question.id];
    if (answer === 3) continue;
    addEvent(question.id, answer === 'unknown' ? 4 : answer < 2 ? 3 : 5);
  }
  events.sort(compareEvents);
  const merged = new Map<string, Event[]>();
  for (const event of events) {
    const group = merged.get(event.actionId) ?? [];
    if (!group.some(e => e.question.id === event.question.id)) group.push(event);
    merged.set(event.actionId, group);
  }
  const item = (id: string, group: Event[] = []): ActionItem => {
    const source = actionLibrary.find(action => action.id === id)!;
    const first = group[0];
    const kind = !first ? 'start' : first.answer === 'unknown' ? 'clarification' : first.priority <= 3 ? 'barrier' : 'improve';
    const label = kind === 'start' ? 'گام شروع' : kind === 'clarification' ? 'نیازمند بررسی' : kind === 'barrier' ? 'نیازمند اقدام' : 'برای تکمیل';
    return { ...source, title: `${label}: ${source.title}`, kind, evidence: group.map(e => evidence(e.question, e.answer)) };
  };
  const ordered = [...merged.entries()];
  const blockers = ordered.filter(([, group]) => group[0].priority <= 4).slice(0, 3).map(([id, group]) => item(id, group));
  const actions = ordered.slice(0, 3).map(([id, group]) => item(id, group));
  for (const id of ['A01', 'A02', 'A10']) {
    if (actions.length === 3) break;
    if (!actions.some(action => action.id === id)) actions.push(item(id));
  }
  const axisResults = axes.map(axis => {
    const values = questions.filter(q => q.axis === axis.id).map(q => snapshot[q.id]).filter((answer): answer is 0 | 1 | 2 | 3 => answer !== 'unknown');
    const raw = values.length >= 4 ? 100 * values.reduce<number>((sum, n) => sum + n, 0) / (3 * values.length) : null;
    return { ...axis, score: raw === null ? null : Math.round(raw), known: values.length,
      level: raw === null ? 'اطلاعات کافی برای جمع‌بندی نداریم' : raw < 40 ? 'نیاز به آماده‌سازی بیشتر' : raw < 70 ? 'بخشی از مقدمات فراهم است' : 'مقدمات بیشتری گزارش شده است' };
  });
  const coverage = ['G01', 'G02', 'G05', 'D01', 'D02', 'F01', 'F03', `${prefix}02`, `${prefix}03`].filter(id => snapshot[id] !== 'unknown').length;
  const personalized = coverage >= 6;
  const policyBlocked = gates.some(g => g.id === 'GATE-POLICY');
  return freeze({
    version: contentVersion, domain, task, axes: axisResults, gates, blockers, actions,
    recommendations: recommendationList(domain, task, snapshot, prefix, gates, personalized), personalized, policyBlocked,
    weeks: [
      { title: 'آماده‌سازی و خط پایه', days: 'روز ۱ تا ۷', body: `یک کار محدود، زمان و کیفیت فعلی، فرد همراه و مجوزها را روشن کنید. ${policyBlocked ? 'بدون ابزار عمومی آماده‌سازی کنید؛ حتی تمرین ساختگی سیاست شرکت را دور نمی‌زند.' : 'نمونه کاملاً ساختگی آماده کنید.'} اولویت‌ها: ${actions.map(a => a.id).join('، ')}.`, output: 'مرز کار، ورودی امن، مسئول و معیارها؛ هر گیت باز مانع اجرای واقعی است.' },
      { title: 'تمرین مجاز و کنترل خطا', days: 'روز ۸ تا ۱۴', body: policyBlocked ? 'تا رفع گیت مجوز در آماده‌سازی بدون ابزار عمومی بمانید؛ پس از تأیید سیاست شرکت، تمرین مجاز با نمونه امن، ثبت خطا و اصلاح دستور.' : 'پس از آماده‌شدن نمونه امن و تأیید سیاست، با قالب تمرین کنید؛ خطا و اصلاح دستور را ثبت و چک‌لیست بازبینی تنظیم کنید.', output: 'حداقل دو نمونه تمرینی مجاز و بررسی‌شده؛ اطلاعات ساختگی و حدس‌های ناموجود رفع شود.' },
      { title: 'اجرای محدود مشروط', days: 'روز ۱۵ تا ۲۱', body: 'فقط پس از تأیید تمام پیش‌نیازها، اجرای محدود در کار موجود و در دامنه مجاز با بازبینی کامل. در صورت بازماندن گیت‌ها، آماده‌سازی ادامه یابد.', output: 'زمان جمع‌آوری، آماده‌سازی، ابزار، بررسی و اصلاح ثبت شود؛ خروجی بدون تأیید استفاده نشود.' },
      { title: 'مرور شواهد و تصمیم', days: 'روز ۲۲ تا ۳۰', body: 'چند نوبت مشابه را از نظر زمان، کیفیت و خطا مقایسه و محدودیت‌ها را ثبت کنید؛ زمان‌بندی وعده نتیجه نیست.', output: 'تصمیم ادامه / اصلاح / توقف؛ نتیجه نامعلوم یا منفی نیز معتبر است. بهبود خودارزیابی اثبات صرفه‌جویی نیست.' },
    ],
    ...practice(domain, task, policyBlocked, gates.length > 0), answers: snapshot,
  });
}
