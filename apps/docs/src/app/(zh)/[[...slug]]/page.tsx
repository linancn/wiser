import type { Metadata } from 'next';

import {
  DocumentRoute,
  documentMetadata,
  staticParams,
} from '@/components/document-route';

export const dynamicParams = false;
export const revalidate = false;

export function generateStaticParams() {
  return staticParams('zh-CN');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  return documentMetadata('zh-CN', (await params).slug);
}

export default async function ChinesePage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  return <DocumentRoute locale="zh-CN" slugs={(await params).slug} />;
}
