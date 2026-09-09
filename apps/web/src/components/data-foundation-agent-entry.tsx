import { AgentSetup } from './agent-setup';
import { SectionHeading } from './data-foundation-workspace';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-foundation-workspace.module.css';

export function DataAgentEntry({ locale }: { readonly locale: Locale }) {
  const dictionary = getDictionary(locale);
  const copy = dictionary.dataFoundation.presentation;
  return (
    <section className={styles.section}>
      <SectionHeading title={copy.intakeTitle} />
      <p>{copy.intakeCopy}</p>
      <ol className={styles.intakeSteps}>
        {copy.intakeSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <AgentSetup
        copy={dictionary.agentSetup}
        setupUrl={
          process.env['WISER_AGENT_SETUP_URL'] ??
          'http://127.0.0.1:3101/agent-setup/prompt.md'
        }
      />
    </section>
  );
}
