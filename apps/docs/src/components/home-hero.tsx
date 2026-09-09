import Link from 'next/link';

import { homeCopy, type DocsLocale } from '@/lib/i18n';

export function HomeHero({ locale }: { locale: DocsLocale }) {
  const copy = homeCopy[locale];
  const prefix = locale === 'zh-CN' ? '' : '/en';
  return (
    <section className="docs-hero">
      <div className="docs-hero-copy">
        <p className="docs-kicker">WISER · PLATFORM</p>
        <h1>wiser water, better future</h1>
        <p>{copy.description}</p>
        <div className="docs-hero-actions">
          <Link href={`${prefix}/quick-start/`}>{copy.start}</Link>
          <Link
            className="secondary"
            href={`${prefix}/architecture/wiser-platform/`}
          >
            {copy.architecture}
          </Link>
        </div>
      </div>
      <div className="docs-hero-instrument" aria-label={copy.summary}>
        <div className="hydro-channel" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <dl>
          <div>
            <dt>{copy.systems}</dt>
            <dd>{copy.systemsValue}</dd>
          </div>
          <div>
            <dt>{copy.protocols}</dt>
            <dd>HTTP · MCP</dd>
          </div>
          <div>
            <dt>{copy.authority}</dt>
            <dd>Auth · Event · Version</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
