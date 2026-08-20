import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const sidebar = [
  {
    label: '开始',
    translations: { en: 'Start' },
    items: [{ slug: 'quick-start' }],
  },
  {
    label: '演练案例',
    translations: { en: 'Exercise scenario' },
    items: [{ slug: 'scenarios/yongding-river-dispatch' }],
  },
  {
    label: '设计边界',
    translations: { en: 'Design boundaries' },
    items: [
      { slug: 'architecture/overview' },
      { slug: 'architecture/security' },
    ],
  },
  {
    label: '接入协议',
    translations: { en: 'Protocols' },
    items: [{ slug: 'protocols/http' }, { slug: 'protocols/mcp' }],
  },
  {
    label: '参与开发',
    translations: { en: 'Contributing' },
    items: [{ slug: 'contributing/tdd' }],
  },
];

export default defineConfig({
  integrations: [
    starlight({
      title: 'Agent EXCON',
      description: '智能体演练场：可运行、可裁决、可回放的真实任务环境。',
      favicon: '/favicon.svg',
      defaultLocale: 'root',
      locales: {
        root: {
          label: '简体中文',
          lang: 'zh-CN',
        },
        en: {
          label: 'English',
          lang: 'en',
        },
      },
      sidebar,
      customCss: ['./src/styles/custom.css'],
      lastUpdated: true,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    }),
  ],
});
