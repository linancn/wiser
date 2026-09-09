import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { PortalLanding } from '@/components/portal-landing';
import { isLocale } from '@/lib/i18n';
import { readVerifiedAuthViewer } from '@/lib/auth';
import { createWiserServerSupabaseClient } from '@/lib/supabase/server';

interface LocalePageProps {
  params: Promise<{ locale: string }>;
}

export default async function LocalePage({ params }: LocalePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  await connection();
  const client = await createWiserServerSupabaseClient();
  const viewer = client === null ? null : await readVerifiedAuthViewer(client);
  return <PortalLanding locale={locale} signedIn={viewer !== null} />;
}
