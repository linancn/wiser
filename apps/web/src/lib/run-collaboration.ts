import type { Locale } from './i18n';
import type {
  CollaborationDeliveryState,
  CollaborationExchange,
  CollaborationKind,
} from './platform';

export interface CollaborationSummary {
  readonly acknowledgedDeliveries: number;
  readonly handoffCount: number;
  readonly openRequestCount: number;
  readonly requestCount: number;
  readonly responseCount: number;
  readonly totalDeliveries: number;
}

export function collaborationSummary(
  exchanges: readonly CollaborationExchange[],
): CollaborationSummary {
  const deliveries = exchanges.flatMap(({ deliveries }) => deliveries);
  return {
    acknowledgedDeliveries: deliveries.filter(
      ({ state }) => state === 'acknowledged',
    ).length,
    handoffCount: exchanges.filter(({ kind }) => kind === 'handoff').length,
    openRequestCount: exchanges.filter(
      ({ kind, status }) => kind === 'request' && status === 'open',
    ).length,
    requestCount: exchanges.filter(({ kind }) => kind === 'request').length,
    responseCount: exchanges.filter(({ kind }) => kind === 'response').length,
    totalDeliveries: deliveries.length,
  };
}

export function deliveryStateLabel(
  state: CollaborationDeliveryState,
  locale: Locale,
): string {
  const labels: Record<
    CollaborationDeliveryState,
    Readonly<Record<Locale, string>>
  > = {
    pending_sync: { 'zh-CN': '待收取', en: 'Awaiting sync' },
    issued: {
      'zh-CN': '已签发可见性收据',
      en: 'Visibility receipt issued',
    },
    acknowledged: {
      'zh-CN': '接收批次已确认',
      en: 'Receipt batch acknowledged',
    },
  };
  return labels[state][locale];
}

export function collaborationKindLabel(
  kind: CollaborationKind,
  locale: Locale,
): string {
  const labels: Record<CollaborationKind, Readonly<Record<Locale, string>>> = {
    handoff: { 'zh-CN': '工件交接', en: 'Artifact handoff' },
    inform: { 'zh-CN': '信息', en: 'Message' },
    request: { 'zh-CN': '请求', en: 'Request' },
    response: { 'zh-CN': '回复', en: 'Response' },
  };
  return labels[kind][locale];
}
