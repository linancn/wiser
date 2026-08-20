import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Agent EXCON',
  description: 'Agent Exercise Control Infrastructure',
  icons: [{ rel: 'icon', url: '/favicon.svg', type: 'image/svg+xml' }],
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
