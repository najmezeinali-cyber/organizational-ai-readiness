'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Assessment, User } from '../../../lib/types';
import { SiteHeader, Footer, Loading, ErrorState, api, authFailure } from '../../../components/ui';
import { ReportView } from '../../../components/report-view';

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const [assessment, setAssessment] = useState<Assessment | null>(null); const [user, setUser] = useState<User | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  async function load() { setLoading(true); setError(''); try { const d = await api<{ assessment: Assessment; user: User }>(`/api/assessments/${encodeURIComponent(id)}`); setAssessment(d.assessment); setUser(d.user); } catch (e) { if (!authFailure(e)) setError((e as Error).message); } finally { setLoading(false); } }
  useEffect(() => { load(); }, [id]);
  return <><SiteHeader /><main id="main" className="public-report section-container">{loading ? <Loading text="در حال دریافت گزارش شما…" /> : error ? <ErrorState message={error} retry={load} /> : assessment?.report ? <ReportView report={assessment.report} pdfUrl={`/api/report/${encodeURIComponent(id)}/pdf`} /> : <div className="empty-state"><h1>گزارش این نوبت هنوز آماده نیست.</h1><p>پاسخ‌ها را تکمیل و پس از مرور، نهایی کنید.</p><Link href={`/assessment/${encodeURIComponent(id)}`} className="button">ادامه ارزیابی</Link></div>}</main><Footer /></>;
}
