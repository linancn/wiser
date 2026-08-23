import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ParticipantPrincipal } from '../src/types.js';
import {
  requireLoopbackJournalAdminUrl,
  withEphemeralJournalDatabase,
  type JournalHmacKeyRing,
} from './support/ephemeral-journal-database.js';

const adminUrl = requireLoopbackJournalAdminUrl();

const operator: ParticipantPrincipal = {
  id: 'postgres-journal-operator',
  participantVersionIds: [],
  roles: ['operator'],
};

const PRIMARY_KEY_ID = 'primary-2026-08';
const OLD_KEY_ID = 'historical-2026-07';
const NEW_KEY_ID = 'current-2026-08';
const PRIMARY_KEY = Buffer.alloc(32, 3).toString('base64url');
const OLD_KEY = Buffer.alloc(32, 5).toString('base64url');
const NEW_KEY = Buffer.alloc(32, 7).toString('base64url');

const primaryKeyRing: JournalHmacKeyRing = {
  activeKeyId: PRIMARY_KEY_ID,
  keys: { [PRIMARY_KEY_ID]: PRIMARY_KEY },
};

const localized = (value: string) => ({
  'zh-CN': `中文 ${value}`,
  en: `English ${value}`,
});

const scenarioInput = (slug: string) => ({
  slug,
  title: localized(slug),
  description: localized(`${slug} description`),
  region: localized(`${slug} region`),
  simulationOnly: true as const,
});

describe.sequential('Agent EXCON v2 journal on real PostgreSQL', () => {
  it('rejects every privileged non-superuser runtime login', async () => {
    await withEphemeralJournalDatabase(adminUrl, async (database) => {
      for (const [attribute, options] of [
        ['bypassRls', { bypassRls: true }],
        ['createDatabase', { createDatabase: true }],
        ['createRole', { createRole: true }],
        ['replication', { replication: true }],
      ] as const) {
        const unsafeLogin = await database.createRuntimeLogin(options);
        await expect(
          database.roleCapabilities(unsafeLogin),
        ).resolves.toMatchObject({
          roleName: unsafeLogin.roleName,
          superuser: false,
          [attribute]: true,
          runtimeMember: true,
        });

        await expect(
          database.openRuntime({
            keyRing: primaryKeyRing,
            login: unsafeLogin,
          }),
        ).rejects.toMatchObject({ code: 'JOURNAL_UNAVAILABLE' });
      }
    });
  });

  it('mutates through a least-privilege login and replays unchanged after restart', async () => {
    await withEphemeralJournalDatabase(adminUrl, async (database) => {
      await expect(database.roleCapabilities()).resolves.toEqual({
        roleName: database.runtimeLogin.roleName,
        superuser: false,
        bypassRls: false,
        createDatabase: false,
        createRole: false,
        replication: false,
        runtimeMember: true,
      });

      const first = await database.openRuntime({ keyRing: primaryKeyRing });
      const created = await first.createScenario(
        operator,
        randomUUID(),
        scenarioInput('postgres-journal-restart'),
      );
      expect(await database.journalCounts()).toEqual({
        intents: 1,
        outcomes: 1,
      });
      await database.closeService(first);

      const restarted = await database.openRuntime({
        keyRing: primaryKeyRing,
      });
      await expect(restarted.isReady()).resolves.toBe(true);
      await expect(restarted.listManageScenarios(operator)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: created.scenario.id }),
        ]),
      );
      expect(await database.journalCounts()).toEqual({
        intents: 1,
        outcomes: 1,
      });
      await database.closeService(restarted);
    });
  });

  it('recovers a committed intent after a real outcome permission failure', async () => {
    await withEphemeralJournalDatabase(adminUrl, async (database) => {
      const first = await database.openRuntime({ keyRing: primaryKeyRing });
      await database.revokeOutcomeInsert();

      await expect(
        first.createScenario(
          operator,
          randomUUID(),
          scenarioInput('postgres-journal-pending-outcome'),
        ),
      ).rejects.toMatchObject({ code: 'JOURNAL_UNAVAILABLE' });
      await expect(first.isReady()).resolves.toBe(false);
      expect(await database.journalCounts()).toEqual({
        intents: 1,
        outcomes: 0,
      });
      await database.closeService(first);

      await database.grantOutcomeInsert();
      const recovered = await database.openRuntime({
        keyRing: primaryKeyRing,
      });
      await expect(recovered.listManageScenarios(operator)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ slug: 'postgres-journal-pending-outcome' }),
        ]),
      );
      expect(await database.journalCounts()).toEqual({
        intents: 1,
        outcomes: 1,
      });
      await database.closeService(recovered);
    });
  });

  it('enforces one session writer and admits a replacement after close', async () => {
    await withEphemeralJournalDatabase(adminUrl, async (database) => {
      const first = await database.openRuntime({ keyRing: primaryKeyRing });

      await expect(
        database.openRuntime({ keyRing: primaryKeyRing }),
      ).rejects.toMatchObject({ code: 'JOURNAL_WRITER_LOCKED' });
      await expect(first.isReady()).resolves.toBe(true);

      await database.closeService(first);
      const replacement = await database.openRuntime({
        keyRing: primaryKeyRing,
      });
      await expect(replacement.isReady()).resolves.toBe(true);
      await database.closeService(replacement);
    });
  });

  it('fails startup when a persisted outcome hash drifts', async () => {
    await withEphemeralJournalDatabase(adminUrl, async (database) => {
      const first = await database.openRuntime({ keyRing: primaryKeyRing });
      await first.createScenario(
        operator,
        randomUUID(),
        scenarioInput('postgres-journal-outcome-drift'),
      );
      await database.closeService(first);

      await database.tamperJournalHash('outcome');
      await expect(
        database.openRuntime({ keyRing: primaryKeyRing }),
      ).rejects.toMatchObject({ code: 'JOURNAL_REPLAY_DRIFT' });
    });
  });

  it('fails startup when a persisted intent envelope is corrupt', async () => {
    await withEphemeralJournalDatabase(adminUrl, async (database) => {
      const first = await database.openRuntime({ keyRing: primaryKeyRing });
      await first.createScenario(
        operator,
        randomUUID(),
        scenarioInput('postgres-journal-intent-corruption'),
      );
      await database.closeService(first);

      await database.tamperJournalHash('intent');
      await expect(
        database.openRuntime({ keyRing: primaryKeyRing }),
      ).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });
    });
  });

  it('fails closed when a historical HMAC key is removed after rotation', async () => {
    await withEphemeralJournalDatabase(adminUrl, async (database) => {
      const historicalOnly: JournalHmacKeyRing = {
        activeKeyId: OLD_KEY_ID,
        keys: { [OLD_KEY_ID]: OLD_KEY },
      };
      const rotated: JournalHmacKeyRing = {
        activeKeyId: NEW_KEY_ID,
        keys: {
          [OLD_KEY_ID]: OLD_KEY,
          [NEW_KEY_ID]: NEW_KEY,
        },
      };
      const currentOnly: JournalHmacKeyRing = {
        activeKeyId: NEW_KEY_ID,
        keys: { [NEW_KEY_ID]: NEW_KEY },
      };

      const first = await database.openRuntime({ keyRing: historicalOnly });
      await first.createScenario(
        operator,
        randomUUID(),
        scenarioInput('postgres-journal-historical-key'),
      );
      await database.closeService(first);

      const afterRotation = await database.openRuntime({ keyRing: rotated });
      await afterRotation.createScenario(
        operator,
        randomUUID(),
        scenarioInput('postgres-journal-current-key'),
      );
      await database.closeService(afterRotation);
      expect(await database.leaseKeyIds()).toEqual([NEW_KEY_ID, OLD_KEY_ID]);

      await expect(
        database.openRuntime({ keyRing: currentOnly }),
      ).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });
    });
  });
});
