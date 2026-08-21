import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { RootDocument } from '@/components/root-document';

import '../../global.css';

export const metadata: Metadata = {
  title: {
    default: 'WISER Water Map · Agent EXCON',
    template: '%s | WISER',
  },
  description: 'Developer documentation for WISER Agent EXCON.',
  icons: [{ rel: 'icon', url: '/favicon.svg', type: 'image/svg+xml' }],
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#edf5f6' },
    { media: '(prefers-color-scheme: dark)', color: '#071a21' },
  ],
};

export default function EnglishLayout({ children }: { children: ReactNode }) {
  return <RootDocument locale="en">{children}</RootDocument>;
}
