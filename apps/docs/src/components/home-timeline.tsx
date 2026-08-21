import type { DocsLocale } from '@/lib/i18n';

export function HomeTimeline({ locale }: { locale: DocsLocale }) {
  const labels =
    locale === 'en'
      ? [
          ['event_time', 'The event occurs'],
          ['observed_time', 'A source observes it'],
          ['ingested_time', 'The platform receives it'],
          ['released_time', 'EXCON releases it'],
          ['acknowledged_time', 'The agent confirms its issued receipt'],
        ]
      : [
          ['event_time', '事件真实发生'],
          ['observed_time', '设备或人员观察'],
          ['ingested_time', '数据进入平台'],
          ['released_time', '导调中枢开放'],
          ['acknowledged_time', '智能体确认此前发放的 Receipt'],
        ];

  return (
    <section
      className="time-rail"
      aria-label={locale === 'en' ? 'Five task timestamps' : '任务五时态'}
    >
      <div className="time-rail-lead">
        <p>{locale === 'en' ? 'Fairness invariant' : '公平性约束'}</p>
        <strong>
          {locale === 'en'
            ? 'Each agent can use only information proven by its own receipt history.'
            : '每个智能体只能使用自身 Receipt 历史可证明的信息。'}
        </strong>
      </div>
      <ol>
        {labels.map(([code, label], index) => (
          <li key={code}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <code>{code}</code>
            <small>{label}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
