import Link from 'next/link';

import type { DocsLocale } from '@/lib/i18n';

export function HomeHero({ locale }: { locale: DocsLocale }) {
  const chinese = locale === 'zh-CN';
  return (
    <section className="docs-hero">
      <div className="docs-hero-copy">
        <p className="docs-kicker">WISER · PLATFORM</p>
        <h1>wiser water, better future</h1>
        <p>
          {chinese
            ? 'WISER 以统一身份、统一界面和统一协议承载水系统智能能力：Agent EXCON 提供可版本化、可裁决的多智能体演练，数据基座提供可审计的数据入库、版本、检索与 GIS 权威链路。'
            : 'WISER uses one identity, interface, and protocol surface for water intelligence: Agent EXCON provides versioned, adjudicable multi-agent exercises, while Data Foundation provides an auditable authority chain for ingestion, versions, search, and GIS.'}
        </p>
        <div className="docs-hero-actions">
          <Link href={chinese ? '/quick-start/' : '/en/quick-start/'}>
            {chinese ? '运行第一个闭环' : 'Run the first loop'}
          </Link>
          <Link
            className="secondary"
            href={
              chinese
                ? '/architecture/wiser-platform/'
                : '/en/architecture/wiser-platform/'
            }
          >
            {chinese ? '查看平台边界' : 'Explore platform boundaries'}
          </Link>
        </div>
      </div>
      <div
        className="docs-hero-instrument"
        aria-label={chinese ? 'WISER 平台能力摘要' : 'WISER platform summary'}
      >
        <div className="hydro-channel" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <dl>
          <div>
            <dt>{chinese ? '业务系统' : 'Systems'}</dt>
            <dd>EXCON · DATA</dd>
          </div>
          <div>
            <dt>{chinese ? '参训协议' : 'Protocols'}</dt>
            <dd>HTTP · MCP</dd>
          </div>
          <div>
            <dt>{chinese ? '权威边界' : 'Authority'}</dt>
            <dd>Auth · Event · Version</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
