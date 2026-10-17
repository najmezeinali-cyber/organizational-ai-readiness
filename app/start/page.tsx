'use client';

import { useState, type FormEvent } from 'react';
import { ArrowUpLeft, HardHat, Package, FolderKanban, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { domains } from '../../lib/content';
import type { Domain, Assessment, User } from '../../lib/types';
import { SiteHeader, Footer, Notice, api } from '../../components/ui';

export default function StartPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [position, setPosition] = useState('');
  const [domain, setDomain] = useState<Domain>('engineering');
  const [task, setTask] = useState('');
  const [otherTitle, setOtherTitle] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = domains.find((item) => item.id === domain)!;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setBusy(true);
    try {
      const account = await api<{ user: User }>('/api/auth', { action: 'guest-register', name, email, position, consent });
      const created = await api<{ assessment: Assessment }>('/api/assessments', { domain, task, ...(task === 'other' ? { otherTitle } : {}) });
      router.push(`/assessment/${created.assessment.id}`);
    } catch (problem) {
      setError((problem as Error).message);
    } finally { setBusy(false); }
  }
  const icons = { engineering: HardHat, procurement: Package, project: FolderKanban };
  return <><SiteHeader /><main id="main" className="start-page"><div className="start-intro"><p className="eyebrow">شروع ارزیابی · بدون ساخت پنل کاربری</p><h1>قبل از شروع، کمی<br /><em>از خودتان و کارتان</em> بگویید.</h1><p>نام، ایمیل و سمت شما فقط برای ثبت این نوبت ارزیابی و ارتباط درباره نتیجه استفاده می‌شود. پاسخ‌ها برای تولید گزارش به مدل هوش مصنوعی ارسال نمی‌شوند.</p><div className="start-meta"><span><ShieldCheck size={17} />۳۰ سؤال در پنج محور</span><span><ShieldCheck size={17} />گزارش مستقل و قابل دانلود</span></div></div><form className="start-form" onSubmit={submit} noValidate><div className="start-form-heading"><span className="start-number">۱</span><div><h2>اطلاعات شما</h2><p>سه فیلد اول الزامی‌اند؛ بدون آن‌ها سؤال‌ها شروع نمی‌شوند.</p></div></div>{error && <Notice tone="error">{error}</Notice>}<div className="start-fields"><label>نام و نام خانوادگی<input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="مثلاً نجمه زینلی" /></label><label>ایمیل کاری یا شخصی<input required type="email" dir="ltr" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><label>سمت شما در سازمان<input required minLength={2} maxLength={100} value={position} onChange={(event) => setPosition(event.target.value)} placeholder="مثلاً مدیر مهندسی" /></label></div><div className="start-form-heading start-heading-gap"><span className="start-number">۲</span><div><h2>از کدام زاویه نگاه می‌کنیم؟</h2><p>حوزه و یک کار تکراری را انتخاب کنید تا سؤال‌ها به کار شما نزدیک‌تر شوند.</p></div></div><fieldset className="domain-fieldset"><legend>حوزه کاری</legend><div className="domain-choices">{domains.map((item) => { const Icon = icons[item.id]; return <label key={item.id} className={`domain-choice ${domain === item.id ? 'selected' : ''}`}><input type="radio" name="domain" value={item.id} checked={domain === item.id} onChange={() => { setDomain(item.id); setTask(''); }} /><Icon size={24} strokeWidth={1.5} /><strong>{item.label}</strong><span>{item.description}</span><span className="radio-indicator" /></label>; })}</div></fieldset><label className="start-task-label">کار تکراری موردنظر<select required value={task} onChange={(event) => setTask(event.target.value)}><option value="">یک گزینه را انتخاب کنید</option>{selected.tasks.filter((item) => item.id !== 'other').map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}<option value="other">کار دیگری مدنظر دارم</option></select></label>{task && task !== 'other' && <p className="field-hint">{selected.tasks.find((item) => item.id === task)?.description}</p>}{task === 'other' && <label className="start-task-label">عنوان عمومی کار<input required maxLength={120} value={otherTitle} onChange={(event) => setOtherTitle(event.target.value)} placeholder="نام فرد، شرکت یا پروژه ننویسید" /></label>}<label className="checkbox-label start-consent"><input type="checkbox" required checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span><a href="/privacy" target="_blank">اطلاعیه حریم خصوصی و شرایط پایلوت</a> را خوانده‌ام و با ثبت اطلاعات و پاسخ‌های خود موافقم.</span></label><button className="button button-full start-submit" disabled={busy || !name.trim() || !email.trim() || !position.trim() || !task || !consent}>{busy ? 'در حال آماده‌سازی ارزیابی…' : 'شروع سؤال‌ها'}<ArrowUpLeft size={20} /></button><p className="start-footnote">پاسخ «نمی‌دانم» در هر سؤال مجاز است و به‌عنوان ضعف صفر امتیاز نمی‌گیرد.</p></form></main><Footer /></>;
}
