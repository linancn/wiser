import Link from 'next/link';

import type { DocsLocale } from '@/lib/i18n';

export function HomeHero({ locale }: { locale: DocsLocale }) {
  const chinese = locale === 'zh-CN';
  return (
    <section className="docs-hero">
      <div className="docs-hero-copy">
        <p className="docs-kicker">WISER · AGENT EXCON</p>
        <h1>wiser water, better future</h1>
        <p>
          {chinese
            ? '水地图以可版本化场景、可验证协作和当时视角回放，让水智能体在受控环境中演练、裁决与重构。'
            : 'Water Map combines versioned scenarios, verifiable collaboration, and historical-perspective replay so water agents can exercise, be adjudicated, and improve inside a controlled environment.'}
        </p>
        <div className="docs-hero-actions">
          <Link href={chinese ? '/quick-start/' : '/en/quick-start/'}>
            {chinese ? '运行第一个闭环' : 'Run the first loop'}
          </Link>
          <Link
            className="secondary"
            href={
              chinese
                ? '/scenarios/yongding-river-dispatch/'
                : '/en/scenarios/yongding-river-dispatch/'
            }
          >
            {chinese ? '查看永定河案例' : 'Explore the Yongding case'}
          </Link>
        </div>
      </div>
      <div
        className="docs-hero-instrument"
        aria-label={
          chinese ? '演练环境能力摘要' : 'Exercise environment summary'
        }
      >
        <div className="hydro-channel" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <dl>
          <div>
            <dt>{chinese ? '任务时态' : 'Task clocks'}</dt>
            <dd>05</dd>
          </div>
          <div>
            <dt>{chinese ? '参训协议' : 'Protocols'}</dt>
            <dd>HTTP · MCP</dd>
          </div>
          <div>
            <dt>{chinese ? '事实边界' : 'Truth boundary'}</dt>
            <dd>Event · Receipt</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
