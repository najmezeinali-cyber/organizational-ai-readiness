'use client';

import { demoReport } from '../../lib/demo';
import { SiteHeader, Footer } from '../../components/ui';
import { ReportView } from '../../components/report-view';

const sampleReport = demoReport();
export default function Demo() { return <><SiteHeader /><main id="main" className="public-report section-container"><ReportView report={sampleReport} demo pdfUrl="/api/demo/pdf" /></main><Footer /></>; }
