import type { ExplorationGraphNode } from '@wiser/data-contracts';
import { dataResourceName } from './data-foundation-presentation';
import { getDictionary, type Locale } from './i18n';

export function graphNodeLabel(
  node: ExplorationGraphNode,
  locale: Locale,
): string {
  const kind =
    getDictionary(locale).dataFoundation.explorer.graphNodeKinds[node.kind];
  const label =
    node.kind === 'ASSET'
      ? (node.label.split('/').at(-1) ?? '')
      : dataResourceName(node.label);
  // Identifiers remain available in the inspector; they are not human names.
  if (/^(?:[a-z]+:)?[a-f\d-]{32,}$/i.test(label) || label === kind) return kind;
  return `${kind} · ${label}`;
}
