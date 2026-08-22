import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '../globals.css';

export const metadata: Metadata = {
  title: 'WISER',
  description: '水系统智能平台',
  icons: [{ rel: 'icon', url: '/favicon.svg', type: 'image/svg+xml' }],
};

export default function RedirectRootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
