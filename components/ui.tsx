'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowUpLeft, LayoutDashboard, ClipboardList, FileText, ShieldCheck, LogOut, Menu, X, LoaderCircle, AlertCircle, Check, Copy, ChevronLeft, Sprout } from 'lucide-react';
import type { User } from '../lib/types';

export const fa = (n: number) => n.toLocaleString('fa-IR');
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(path, { method: method || (body === undefined ? 'GET' : 'POST'), credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-App-Request': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || 'ارتباط با سامانه برقرار نشد. دوباره تلاش کنید.', response.status);
  return data as T;
}
export function authFailure(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 401) { window.location.assign('/auth?mode=login'); return true; }
  if (error instanceof ApiError && error.status === 403) { window.location.assign('/auth?mode=verify'); return true; }
  return false;
}
export function useMe() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mailMode, setMailMode] = useState<'file' | 'smtp'>('smtp');
  useEffect(() => { let live = true; api<{ user: User | null; mailMode: 'file' | 'smtp' }>('/api/me').then(d => { if (live) { setUser(d.user); setMailMode(d.mailMode); } }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, []);
  return { user, loading, error, mailMode };
}
export function Brand({ inverse = false }: { inverse?: boolean }) {
  return <Link href="/" className={`brand ${inverse ? 'brand-inverse' : ''}`} aria-label="نجمه زینلی؛ صفحه اصلی"><span className="brand-mark"><img src="/brand/logo.png" alt="NZ" width="48" height="48" /></span><span><strong>نجمه زینلی</strong><small>هوش مصنوعی در کار واقعی</small></span></Link>;
}
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return <header className="site-header"><div className="header-inner"><Brand /><nav aria-label="ناوبری اصلی" className={open ? 'header-nav is-open' : 'header-nav'}><Link href="/#approach" onClick={() => setOpen(false)}>مسیر شروع</Link><Link href="/demo" onClick={() => setOpen(false)}>نمونه گزارش</Link><Link href="/privacy" onClick={() => setOpen(false)}>حریم خصوصی</Link></nav><div className="header-actions"><Link href="/start" className="button button-small">شروع ارزیابی <ArrowUpLeft size={16} /></Link><button className="icon-button mobile-menu" aria-label={open ? 'بستن فهرست' : 'باز کردن فهرست'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button></div></div></header>;
}
export function Footer() { return <footer className="site-footer"><div><Brand /><p>از یک کار کوچک شروع کنید؛ با ورودی امن و تصمیم انسانی.</p></div><div className="footer-links"><Link href="/demo">گزارش نمونه</Link><Link href="/privacy">حریم خصوصی و شرایط پایلوت</Link><span>نسخه آزمایشی • بدون اتصال به مدل هوش مصنوعی</span></div></footer>; }
export function AppShell({ children, user, title = 'میز کار' }: { children: ReactNode; user?: User | null; title?: string }) {
  const path = usePathname(); const [open, setOpen] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function logout() { setBusy(true); try { await api('/api/auth', { action: 'logout' }); window.location.assign('/'); } catch (e) { setError((e as Error).message); setBusy(false); } }
  return <div className="app-shell"><aside className={`app-sidebar ${open ? 'is-open' : ''}`}><Brand inverse /><div className="sidebar-caption">فضای کار شما</div><nav aria-label="فضای کار"><Link className={path === '/workspace' ? 'active' : ''} href="/workspace"><LayoutDashboard size={19} />میز کار</Link><Link className={path.startsWith('/assessment') ? 'active' : ''} href="/workspace#new"><ClipboardList size={19} />ارزیابی جدید</Link><Link className={path.startsWith('/report') ? 'active' : ''} href="/workspace#history"><FileText size={19} />گزارش‌های من</Link><Link href="/demo"><Sprout size={19} />یک نمونه واقعی‌نما</Link>{user?.role === 'admin' && <Link href="/admin" className={path === '/admin' ? 'active' : ''}><ShieldCheck size={19} />مدیریت پایلوت</Link>}</nav><div className="sidebar-note"><ShieldCheck size={23} /><strong>شروع امن، تصمیم روشن</strong><p>پاسخ‌ها را بدون درج نام شرکت، پروژه یا اطلاعات محرمانه ثبت کنید.</p><Link href="/privacy">درباره حریم خصوصی <ChevronLeft size={14} /></Link></div><div className="sidebar-user"><span className="avatar">{user?.name?.slice(0, 1) || 'ن'}</span><div><strong>{user?.name || 'فضای شخصی'}</strong><small>{user?.verified ? 'ایمیل تأیید شده' : 'نسخه آزمایشی رایگان'}</small></div><button onClick={logout} disabled={busy} className="icon-button" aria-label="خروج از حساب">{busy ? <LoaderCircle className="spin" size={18} /> : <LogOut size={18} />}</button></div>{error && <p role="alert" className="sidebar-error">{error}</p>}</aside><div className="app-body"><header className="app-topbar"><div><button className="icon-button mobile-menu" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="فهرست فضای کار"><Menu size={21} /></button><span>فضای کار</span><ChevronLeft size={14} /><strong>{title}</strong></div><span className="pilot-label"><span />نسخه آزمایشی</span></header><main id="main" className="workspace-main">{children}</main><div className="app-bottom"><span>خودارزیابی اولیه؛ نه ممیزی و نه گواهی آمادگی</span><Link href="/privacy">حریم خصوصی</Link></div></div></div>;
}
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' | 'warning' }) { return <div role={tone === 'error' ? 'alert' : 'status'} className={`notice notice-${tone}`}>{tone === 'success' ? <Check size={19} /> : <AlertCircle size={19} />}<div>{children}</div></div>; }
export function Loading({ text = 'در حال دریافت اطلاعات…' }: { text?: string }) { return <div className="loading-state" role="status"><LoaderCircle size={27} className="spin" /><p>{text}</p></div>; }
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) { return <div className="empty-state"><AlertCircle size={32} /><h2>اطلاعات دریافت نشد</h2><p role="alert">{message}</p>{retry && <button className="button button-outline" onClick={retry}>دوباره تلاش کنید</button>}</div>; }
export function CopyBlock({ title, text }: { title: string; text: string }) {
  const [state, setState] = useState('');
  async function copy() { try { await navigator.clipboard.writeText(text); setState('کپی شد'); } catch { setState('کپی خودکار ممکن نیست؛ متن زیر را انتخاب و کپی کنید.'); } }
  return <section className="copy-block"><div className="section-heading"><h3>{title}</h3><button className="text-button" onClick={copy}><Copy size={16} />کپی متن</button></div><pre tabIndex={0}>{text}</pre>{state && <small role="status">{state}</small>}</section>;
}
export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) { return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>; }
