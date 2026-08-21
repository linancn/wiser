import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';

import type { DocsLocale } from '@/lib/i18n';
import { i18nUI } from '@/lib/i18n';

import { StaticSearchDialog } from './static-search-dialog';

export function RootDocument({
  children,
  locale,
}: {
  children: ReactNode;
  locale: DocsLocale;
}) {
  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <RootProvider
          i18n={i18nUI.provider(locale)}
          search={{ SearchDialog: StaticSearchDialog }}
          theme={{
            attribute: 'class',
            defaultTheme: 'system',
            enableSystem: true,
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
