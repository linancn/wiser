import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

import type { DocsLocale } from './i18n';
import { i18nConfig, localeHome } from './i18n';

function RiverMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 44 44" aria-hidden="true">
      <path d="M5 24c7 0 8-10 15-10s8 10 15 10c2.5 0 4.5-.8 6-3" />
      <path className="brand-bank" d="M8 33h28" />
      <circle cx="20" cy="14" r="2.8" />
    </svg>
  );
}

function Brand() {
  return (
    <span className="brand-lockup">
      <RiverMark />
      <span>
        <strong>WISER</strong>
        <small>水地图 · Agent EXCON</small>
      </span>
    </span>
  );
}

export function baseOptions(locale: DocsLocale): BaseLayoutProps {
  const chinese = locale === 'zh-CN';
  return {
    githubUrl: 'https://github.com/linancn/wiser',
    i18n: i18nConfig,
    nav: {
      title: <Brand />,
      url: localeHome(locale),
    },
    links: [
      {
        text: chinese ? '快速开始' : 'Quick start',
        url: chinese ? '/quick-start/' : '/en/quick-start/',
        active: 'nested-url',
      },
      {
        text: 'HTTP',
        url: chinese ? '/protocols/http/' : '/en/protocols/http/',
        active: 'nested-url',
      },
      {
        text: 'MCP',
        url: chinese ? '/protocols/mcp/' : '/en/protocols/mcp/',
        active: 'nested-url',
      },
    ],
    searchToggle: { enabled: true },
    themeSwitch: { enabled: true },
  };
}
