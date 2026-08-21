import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/page';

import type { DocsLocale } from '@/lib/i18n';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';

function getPage(locale: DocsLocale, slugs?: string[]) {
  const page = source.getPage(slugs, locale);
  if (!page) notFound();
  return page;
}

export function staticParams(locale: DocsLocale) {
  return source
    .generateParams()
    .filter((item) => item.lang === locale)
    .map(({ slug }) => ({ slug }));
}

export function documentMetadata(
  locale: DocsLocale,
  slugs?: string[],
): Metadata {
  const page = getPage(locale, slugs);
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: {
      languages: {
        'zh-CN': page.url.replace(/^\/en(?=\/|$)/, '') || '/',
        en: page.url.startsWith('/en') ? page.url : `/en${page.url}`,
      },
    },
  };
}

export function DocumentRoute({
  locale,
  slugs,
}: {
  locale: DocsLocale;
  slugs?: string[];
}) {
  const page = getPage(locale, slugs);
  const MDX = page.data.body;
  const layout = baseOptions(locale);

  if ((slugs?.length ?? 0) === 0) {
    return (
      <HomeLayout {...layout} className="wiser-home-layout">
        <div className="wiser-home">
          <MDX components={getMDXComponents()} />
        </div>
      </HomeLayout>
    );
  }

  return (
    <DocsLayout {...layout} tree={source.getPageTree(locale)}>
      <DocsPage
        toc={page.data.toc}
        full={page.data.full}
        editOnGithub={{
          owner: 'linancn',
          repo: 'wiser',
          sha: 'main',
          path: `apps/docs/src/content/docs/${page.path}`,
        }}
      >
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX components={getMDXComponents()} />
        </DocsBody>
      </DocsPage>
    </DocsLayout>
  );
}
