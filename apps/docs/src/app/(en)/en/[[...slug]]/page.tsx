import type { Metadata } from 'next';

import {
  DocumentRoute,
  documentMetadata,
  staticParams,
} from '@/components/document-route';

export const dynamicParams = false;
export const revalidate = false;

export function generateStaticParams() {
  return staticParams('en');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  return documentMetadata('en', (await params).slug);
}

export default async function EnglishPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  return <DocumentRoute locale="en" slugs={(await params).slug} />;
}
