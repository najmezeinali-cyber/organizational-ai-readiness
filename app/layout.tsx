import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: { default: 'از ارزیابی تا یک شروع واقعی | نجمه زینلی', template: '%s | نجمه زینلی' }, description: 'خودارزیابی اولیه استفاده از هوش مصنوعی برای مدیران مهندسی، تدارکات و پروژه؛ پنج محور، پیشنهادهای روشن و برنامه آزمایش ۳۰روزه.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="fa" dir="rtl"><body><a href="#main" className="skip-link">رفتن به محتوای اصلی</a>{children}</body></html>; }
