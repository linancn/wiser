import type { MDXComponents } from 'mdx/types';
import defaultMdxComponents from 'fumadocs-ui/mdx';

import { HomeHero } from '@/components/home-hero';
import { HomeTimeline } from '@/components/home-timeline';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    HomeHero,
    HomeTimeline,
    ...components,
  };
}
