import { notFound } from 'next/navigation';

import { PortalLanding } from '@/components/portal-landing';
import { isLocale } from '@/lib/i18n';

interface LocalePageProps {
  params: Promise<{ locale: string }>;
}

export default async function LocalePage({ params }: LocalePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <PortalLanding locale={locale} />;
}
