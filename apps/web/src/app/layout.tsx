import type { Metadata } from 'next';
import Script from 'next/script';
import { Providers } from '../Providers';
import '../styles.css';
import '../auth/auth.css';
import '../dashboard-theme.css';

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL ? 'https://app.cupkey.io' : 'http://127.0.0.1:5173');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Cupkey — Plan your day, prove your hours',
    template: '%s · Cupkey',
  },
  description:
    'Cupkey helps you schedule tasks, track focus time, earn effort badges, and export timesheets for your team lead.',
  applicationName: 'Cupkey',
  keywords: [
    'time blocking',
    'timesheet',
    'daily planner',
    'productivity',
    'task schedule',
    'effort tracking',
  ],
  openGraph: {
    title: 'Cupkey — Plan your day, prove your hours',
    description:
      'Schedule tasks, track real time, and download timesheets for work reporting.',
    type: 'website',
    siteName: 'Cupkey',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cupkey — Plan your day, prove your hours',
    description:
      'Schedule tasks, track real time, and download timesheets for work reporting.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
