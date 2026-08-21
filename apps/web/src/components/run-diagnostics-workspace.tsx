import type { Locale } from '../lib/i18n';
import type { ExerciseRun, PlatformScenario } from '../lib/platform';
import { RunDiagnosticsPanel } from './run-diagnostics-panel';
import styles from './run-diagnostics-workspace.module.css';
import { RunWorkspaceHeader } from './run-workspace';

export function RunDiagnosticsWorkspace({
  locale,
  run,
  scenario,
}: {
  readonly locale: Locale;
  readonly run: ExerciseRun;
  readonly scenario: PlatformScenario;
}) {
  return (
    <main id="main-content">
      <RunWorkspaceHeader
        active="diagnostics"
        locale={locale}
        run={run}
        scenario={scenario}
      />
      <div className={styles.content}>
        <RunDiagnosticsPanel locale={locale} run={run} scenario={scenario} />
      </div>
    </main>
  );
}
