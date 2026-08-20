'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { demoFixture } from '@/lib/api';
import { getDictionary, type Locale } from '@/lib/i18n';
import { yongdingScenario, type ReplayEvent } from '@/lib/scenario';

type TraceCategory = ReplayEvent['category'];
type TraceFilter = 'all' | TraceCategory;

const filterOrder: TraceFilter[] = [
  'all',
  'inject',
  'observation',
  'submission',
  'evaluation',
  'feedback',
];

const filterKey = {
  all: 'filterAll',
  inject: 'filterInject',
  observation: 'filterObservation',
  submission: 'filterSubmission',
  evaluation: 'filterEvaluation',
  feedback: 'filterFeedback',
} as const;

function RiverGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="brand-glyph">
      <path d="M4 28c8 0 8-10 16-10s8 10 16 10c4 0 6-2 8-5" />
      <circle cx="20" cy="18" r="3" />
      <path d="M8 37h32" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="inline-icon">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

function PlayIcon({ pause = false }: { pause?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="inline-icon">
      {pause ? <path d="M7 5v10M13 5v10" /> : <path d="m7 5 8 5-8 5Z" />}
    </svg>
  );
}

function WaterSystemMap({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  const locationNames = yongdingScenario.locations.map(
    (location) => location[locale],
  );

  return (
    <div className="map-frame">
      <div className="map-head">
        <span>{dictionary.console.systemTitle}</span>
        <span className="map-live">
          <i aria-hidden="true" /> {dictionary.console.status}
        </span>
      </div>
      <svg
        className="water-map"
        viewBox="0 0 1120 390"
        role="img"
        aria-label={dictionary.a11y.network}
      >
        <defs>
          <filter id="river-glow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="map-contours" aria-hidden="true">
          <path d="M0 98c145-66 251 45 408-6s274-91 446-31 211 11 266-18" />
          <path d="M0 308c132-45 258 41 399 2s251-78 423-28 236 3 298-32" />
          <path d="M220 0c-37 91 43 123 4 210s-4 145 63 180" />
          <path d="M927 0c24 81-30 123 14 201s31 132-18 189" />
        </g>
        <g className="tributaries" aria-hidden="true">
          <path d="M68 75c84 23 125 63 190 116" />
          <path d="M110 300c61-45 101-65 148-91" />
          <path d="M698 350c-13-70-36-91-54-116" />
          <path d="M864 56c-67 47-107 87-140 132" />
        </g>
        <path
          className="river-shadow"
          d="M72 198C212 129 287 265 405 207s183-61 292-10 194 47 351-4"
        />
        <path
          className="river-line"
          d="M72 198C212 129 287 265 405 207s183-61 292-10 194 47 351-4"
        />
        <g className="map-nodes">
          {[92, 366, 650, 1026].map((x, index) => {
            const y = [190, 218, 181, 198][index] ?? 198;
            return (
              <g key={x} transform={`translate(${x} ${y})`}>
                <circle
                  className={index === 2 ? 'node current' : 'node'}
                  r="10"
                />
                <circle className="node-core" r="3" />
                <text
                  className="node-label"
                  x="0"
                  y={index % 2 === 0 ? -27 : 38}
                >
                  {locationNames[index]}
                </text>
              </g>
            );
          })}
        </g>
        <g className="source-labels">
          <g transform="translate(68 69)">
            <circle r="5" />
            <text x="14" y="5">
              {yongdingScenario.sources[0].name[locale]}
            </text>
          </g>
          <g transform="translate(113 304)">
            <circle r="5" />
            <text x="14" y="5">
              {yongdingScenario.sources[1].name[locale]}
            </text>
          </g>
          <g transform="translate(700 350)">
            <circle r="5" />
            <text x="14" y="5">
              {yongdingScenario.sources[2].name[locale]}
            </text>
          </g>
          <g transform="translate(863 51)">
            <circle r="5" />
            <text x="14" y="5">
              {yongdingScenario.sources[3].name[locale]}
            </text>
          </g>
        </g>
      </svg>
      <div className="map-time-rail" aria-label={dictionary.a11y.timeline}>
        {['T+00', 'T+06', 'T+12', 'T+14', 'T+24'].map((time) => (
          <span key={time} className={time === 'T+12' ? 'is-current' : ''}>
            <i aria-hidden="true" />
            {time}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ControlRoom({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  const session = demoFixture;
  const [filter, setFilter] = useState<TraceFilter>('all');
  const [selectedIndex, setSelectedIndex] = useState(4);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!playing) return;
    const interval = window.setInterval(() => {
      setSelectedIndex((current) => {
        if (current >= yongdingScenario.events.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1500);
    return () => window.clearInterval(interval);
  }, [playing]);

  const filteredEvents = useMemo(
    () =>
      filter === 'all'
        ? yongdingScenario.events
        : yongdingScenario.events.filter((event) => event.category === filter),
    [filter],
  );
  const selectedEvent =
    yongdingScenario.events[selectedIndex] ?? yongdingScenario.events[0];
  const languageHref = locale === 'zh-CN' ? '/en' : '/zh-CN';

  return (
    <div className="site-shell" lang={locale}>
      <a className="skip-link" href="#main-content">
        {dictionary.a11y.skip}
      </a>

      <header className="site-header">
        <Link
          className="brand"
          href={`/${locale}`}
          aria-label={dictionary.brand.name}
        >
          <RiverGlyph />
          <span>
            <strong>{dictionary.brand.name}</strong>
            <small>{dictionary.brand.product}</small>
          </span>
        </Link>
        <nav className="primary-nav" aria-label={dictionary.brand.role}>
          <a href="#scenario">{dictionary.nav.scenario}</a>
          <a href="#console">{dictionary.nav.console}</a>
          <a href="#replay">{dictionary.nav.replay}</a>
        </nav>
        <div className="header-tools">
          <span className="environment-label">
            {dictionary.brand.environment}
          </span>
          <Link
            className="language-link"
            href={languageHref}
            hrefLang={locale === 'zh-CN' ? 'en' : 'zh-CN'}
            aria-label={`${dictionary.a11y.language}：${dictionary.a11y.otherLanguage}`}
          >
            {dictionary.a11y.otherLanguage}
          </Link>
        </div>
      </header>

      <main id="main-content">
        <section className="hero" aria-labelledby="scenario-title">
          <div className="hero-copy">
            <p className="eyebrow">{dictionary.hero.kicker}</p>
            <h1 id="scenario-title">{yongdingScenario.title[locale]}</h1>
            <p className="hero-summary">{dictionary.hero.summary}</p>
            <div className="hero-actions">
              <a className="primary-link" href="#console">
                {dictionary.hero.openConsole} <ArrowIcon />
              </a>
              <a className="text-link" href="#scenario">
                {dictionary.hero.readScenario}
              </a>
            </div>
          </div>
          <dl className="hero-readouts">
            <div>
              <dt>{dictionary.hero.mode}</dt>
              <dd>{dictionary.hero.modeValue}</dd>
            </div>
            <div>
              <dt>{dictionary.hero.clock}</dt>
              <dd className="mono">{session.virtualTime}</dd>
            </div>
            <div>
              <dt>{dictionary.hero.currentPhase}</dt>
              <dd>{dictionary.hero.currentPhaseValue}</dd>
            </div>
          </dl>
          <WaterSystemMap locale={locale} />
        </section>

        <section id="scenario" className="content-section scenario-section">
          <div className="section-intro">
            <p className="eyebrow">{dictionary.scenario.eyebrow}</p>
            <h2>{dictionary.scenario.heading}</h2>
            <p>{dictionary.scenario.lede}</p>
          </div>
          <div className="brief-grid">
            <article>
              <span className="brief-marker boundary" aria-hidden="true" />
              <h3>{dictionary.scenario.boundaryTitle}</h3>
              <p>{dictionary.scenario.boundary}</p>
            </article>
            <article>
              <span className="brief-marker task" aria-hidden="true" />
              <h3>{dictionary.scenario.taskTitle}</h3>
              <p>{dictionary.scenario.task}</p>
            </article>
            <article>
              <span className="brief-marker verdict" aria-hidden="true" />
              <h3>{dictionary.scenario.verdictTitle}</h3>
              <p>{dictionary.scenario.verdict}</p>
            </article>
          </div>
          <div className="anchor-register">
            <div>
              <span>{dictionary.scenario.sourceLabel}</span>
              <ul>
                {yongdingScenario.sources.map((source) => (
                  <li key={source.id}>{source.name[locale]}</li>
                ))}
              </ul>
            </div>
            <div>
              <span>{dictionary.scenario.locationLabel}</span>
              <ul>
                {yongdingScenario.locations.map((location) => (
                  <li key={location.en}>{location[locale]}</li>
                ))}
              </ul>
            </div>
            <strong>{dictionary.scenario.disclaimer}</strong>
          </div>
        </section>

        <section id="console" className="console-section">
          <div className="console-inner">
            <div className="section-intro console-intro">
              <p className="eyebrow">{dictionary.console.eyebrow}</p>
              <div className="console-title-line">
                <h2>{dictionary.console.heading}</h2>
                <span className="readonly-badge">
                  <i aria-hidden="true" /> {dictionary.console.readonly}
                </span>
              </div>
              <p>{dictionary.console.lede}</p>
              <code>{dictionary.console.transport}</code>
            </div>

            <dl className="console-metrics">
              <div>
                <dt>{dictionary.console.agentLabel}</dt>
                <dd>{dictionary.console.agentValue}</dd>
              </div>
              <div>
                <dt>{dictionary.console.providerLabel}</dt>
                <dd>{dictionary.console.providerValue}</dd>
              </div>
              <div>
                <dt>{dictionary.console.versionLabel}</dt>
                <dd>{dictionary.console.versionValue}</dd>
              </div>
              <div className="score-metric">
                <dt>{dictionary.console.scoreLabel}</dt>
                <dd>{dictionary.console.scoreValue}</dd>
                <small>{dictionary.console.scoreNote}</small>
              </div>
              <div>
                <dt>{dictionary.console.checkpointLabel}</dt>
                <dd>{dictionary.console.checkpointValue}</dd>
              </div>
              <div>
                <dt>{dictionary.console.evidenceLabel}</dt>
                <dd>{dictionary.console.evidenceValue}</dd>
              </div>
            </dl>

            <div className="console-grid">
              <section
                className="network-monitor"
                aria-labelledby="network-heading"
              >
                <div className="panel-heading">
                  <h3 id="network-heading">{dictionary.console.systemTitle}</h3>
                  <span className="mono">{dictionary.hero.clockValue}</span>
                </div>
                <div className="source-rows">
                  {yongdingScenario.sources.map((source) => (
                    <div className="source-row" key={source.id}>
                      <div className="source-copy">
                        <strong>{source.name[locale]}</strong>
                        <small>{source.detail[locale]}</small>
                      </div>
                      <div className="flow-track" aria-hidden="true">
                        <i
                          style={
                            {
                              '--flow-width': `${Math.round((source.flow / 20) * 100)}%`,
                            } as CSSProperties
                          }
                        />
                      </div>
                      <span className="flow-value mono">
                        {source.flow.toFixed(1)}{' '}
                        <small>{dictionary.console.flowUnit}</small>
                      </span>
                      <span className={`source-state ${source.state}`}>
                        {dictionary.console[source.state]}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="trace-panel" aria-labelledby="trace-heading">
                <div className="panel-heading trace-heading">
                  <div>
                    <h3 id="trace-heading">{dictionary.console.traceTitle}</h3>
                    <p>{dictionary.console.traceNote}</p>
                  </div>
                </div>
                <div
                  className="trace-filters"
                  aria-label={dictionary.console.filtersLabel}
                >
                  {filterOrder.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={filter === category ? 'is-active' : ''}
                      aria-pressed={filter === category}
                      onClick={() => setFilter(category)}
                    >
                      {dictionary.console[filterKey[category]]}
                    </button>
                  ))}
                </div>
                <ol
                  className="trace-list"
                  aria-label={dictionary.console.traceTitle}
                >
                  {filteredEvents.map((event) => (
                    <li
                      key={event.sequence}
                      className={`trace-event ${event.category}`}
                    >
                      <time className="mono">{event.time}</time>
                      <span className="trace-pin" aria-hidden="true" />
                      <div>
                        <span className="trace-category">
                          {dictionary.console[filterKey[event.category]]}
                        </span>
                        <strong>{event.type[locale]}</strong>
                        <p>{event.detail[locale]}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
        </section>

        <section id="replay" className="content-section replay-section">
          <div className="section-intro replay-intro">
            <p className="eyebrow">{dictionary.replay.eyebrow}</p>
            <h2>{dictionary.replay.heading}</h2>
            <p>{dictionary.replay.lede}</p>
          </div>
          <div className="replay-console">
            <div className="replay-toolbar">
              <button
                type="button"
                onClick={() => setPlaying((value) => !value)}
              >
                <PlayIcon pause={playing} />
                {playing ? dictionary.replay.pause : dictionary.replay.play}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setSelectedIndex(0);
                }}
              >
                {dictionary.replay.reset}
              </button>
              <span className="mono">
                {String(selectedIndex + 1).padStart(2, '0')} /{' '}
                {String(yongdingScenario.events.length).padStart(2, '0')}
              </span>
            </div>
            <div className="replay-rail" aria-label={dictionary.a11y.timeline}>
              <div
                className="replay-progress"
                style={{ width: `${(selectedIndex / 6) * 100}%` }}
              />
              {yongdingScenario.events.map((event, index) => (
                <button
                  key={event.sequence}
                  type="button"
                  className={index === selectedIndex ? 'is-current' : ''}
                  style={{ left: `${(index / 6) * 100}%` }}
                  onClick={() => {
                    setPlaying(false);
                    setSelectedIndex(index);
                  }}
                  aria-label={`${event.time} · ${event.type[locale]}`}
                >
                  <i aria-hidden="true" />
                  <span>{event.time}</span>
                </button>
              ))}
            </div>
            <article className={`event-inspector ${selectedEvent.category}`}>
              <div className="event-sequence mono">
                #{String(selectedEvent.sequence).padStart(3, '0')}
              </div>
              <div className="event-main">
                <span>{dictionary.replay.current}</span>
                <h3>{selectedEvent.type[locale]}</h3>
                <p>{selectedEvent.detail[locale]}</p>
              </div>
              <dl>
                <div>
                  <dt>{dictionary.replay.virtualTime}</dt>
                  <dd className="mono">{selectedEvent.time}</dd>
                </div>
                <div>
                  <dt>{dictionary.replay.actor}</dt>
                  <dd>{selectedEvent.actor[locale]}</dd>
                </div>
                <div>
                  <dt>{dictionary.replay.hash}</dt>
                  <dd className="mono">{selectedEvent.digest}</dd>
                </div>
              </dl>
            </article>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span>{dictionary.footer.note}</span>
        <span>{dictionary.footer.architecture}</span>
      </footer>
    </div>
  );
}
