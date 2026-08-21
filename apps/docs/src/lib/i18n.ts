import { defineI18n, type I18nConfig } from 'fumadocs-core/i18n';
import { defineI18nUI } from 'fumadocs-ui/i18n';

export const locales = ['zh-CN', 'en'] as const;
export type DocsLocale = (typeof locales)[number];
export const defaultLocale: DocsLocale = 'zh-CN';

export const i18nConfig = {
  languages: [...locales],
  defaultLanguage: defaultLocale,
  fallbackLanguage: null,
  hideLocale: 'default-locale',
  parser: 'dir',
} satisfies I18nConfig<DocsLocale>;

export const i18n = defineI18n(i18nConfig);

export const i18nUI = defineI18nUI(i18n, {
  'zh-CN': {
    displayName: '简体中文',
    'Ask AI(AI chat button)': '询问 AI',
    'Back to Home(404 page)': '返回文档首页',
    'Choose a language(language switcher)': '选择语言',
    'Choose a language(language switcher)(aria-label)': '选择文档语言',
    'Close Banner(banner)(aria-label)': '关闭横幅',
    'Close Search(search dialog)(aria-label)': '关闭搜索',
    'Close Sidebar(aria-label)': '关闭侧栏',
    'Close Sidebar(sidebar)(aria-label)': '关闭文档侧栏',
    'Collapse Sidebar(sidebar)(aria-label)': '收起文档侧栏',
    'Copied Text(code block)(aria-label)': '已复制代码',
    'Copy Anchor Link(heading anchor)(aria-label)': '复制标题链接',
    'Copy Link(accordion)(aria-label)': '复制链接',
    'Copy Markdown(page actions)': '复制 Markdown',
    'Copy Text(code block)(aria-label)': '复制代码',
    'Dark(theme switcher)(aria-label)': '深色模式',
    'Default(type table)': '默认值',
    'Edit on GitHub(edit page)': '在 GitHub 编辑',
    'Hide Sidebar(sidebar)': '隐藏侧栏',
    'Last updated on(page footer)': '最后更新',
    'Layout Tab(layout tab trigger)': '文档分区',
    'Light(theme switcher)(aria-label)': '浅色模式',
    'Next Page(pagination)': '下一页',
    'No Headings(table of contents)': '本页没有小节',
    'No results found(search dialog)': '没有找到匹配内容',
    'On this page(table of contents)': '本页目录',
    'Open Search(search trigger)(aria-label)': '打开文档搜索',
    'Open Sidebar(sidebar)(aria-label)': '打开文档侧栏',
    'Open in ChatGPT(page actions)': '在 ChatGPT 中打开',
    'Open in Claude(page actions)': '在 Claude 中打开',
    'Open in Cursor(page actions)': '在 Cursor 中打开',
    'Open in GitHub(page actions)': '在 GitHub 中打开',
    'Open in Scira AI(page actions)': '在 Scira AI 中打开',
    'Open(page actions)': '打开',
    'Page Not Found(404 page)': '页面不存在',
    'Parameters(type table)': '参数',
    'Previous Page(pagination)': '上一页',
    'Prop(type table)': '属性',
    'Read {url}, I want to ask questions about it.(page actions)':
      '请阅读 {url}，我想就此提问。',
    'Returns(type table)': '返回值',
    'Search(search dialog)': '搜索文档',
    'Search(search trigger)': '搜索',
    'Show Sidebar(sidebar)': '显示侧栏',
    'System(theme switcher)(aria-label)': '跟随系统',
    'Table of Contents(inline table of contents)': '目录',
    'The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 page)':
      '该页面可能已移动、更名或暂时不可用。',
    'Toggle Menu(mobile menu)(aria-label)': '切换移动端菜单',
    'Toggle Theme(theme switcher)(aria-label)': '切换显示主题',
    'Type(type table)': '类型',
    'View as Markdown(page actions)': '查看 Markdown',
  },
  en: {
    displayName: 'English',
  },
});

export function localeHome(locale: DocsLocale): string {
  return locale === defaultLocale ? '/' : `/${locale}/`;
}
