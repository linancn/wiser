import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { isLocale } from '@/lib/i18n';

export default async function DataFoundationLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return children;
}
