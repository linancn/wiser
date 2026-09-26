import {
  assertResourceManagementPolicy,
  type ResourceManagementPermit,
} from './resource-management-policy.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  ResourceBatchViewSchema,
  ResourceGrantDifferenceSchema,
  resourceAccessReferenceKey,
  type ResourceGrantDifference,
  type ResourceAccessAction,
  ResourceBatchesPageSchema,
  type ResourceBatchesQuery,
  type ResourceBatchesPage,
  ResourcePackageCommandSchema,
  type PlatformRequestContext,
  type ResourceBatchView,
  type ResourceBatchPreviewCommand,
  type ResourceBatchDecision,
  type ResourceBatchAction,
  type ResourcePackageCommand,
} from '@wiser/platform-contracts';
import type { VerifiedSupabaseJwtClaims } from './index.js';
import type { PlatformDelegationTransactionClient as Client } from './postgres-platform-delegation-service.js';
import {
  createPostgresAuthorizationContextLoader,
  type AuthorizationRow,
} from './postgres-authorization.js';
import { resourceAdministrationFailure as fail } from './resource-administration-error.js';
import type { ResourceAdministrationOptions } from './resource-administration-service.js';
import {
  resourceGrantDiff,
  type ResourceGrantWindow,
} from './resource-grant-diff.js';
export interface ResourceAdministrationSession {
  client: Client;
  human: VerifiedSupabaseJwtClaims;
  project: { id: string; tenant_id: string };
  context: PlatformRequestContext;
}
interface Definitions {
  package_id: string;
  package_version: number;
  package_name: string;
  resources: ResourcePackageCommand['resources'];
  allowed_actions: string[];
  license_basis: string;
  preset_id: string;
  preset_version: number;
  preset_name: string;
  actions: string[];
  max_days: number;
  approval_level: 'ordinary' | 'important';
  latest_package: number;
  latest_preset: number;
}
interface Batch extends Definitions {
  id: string;
  project_id: string;
  applicant_id: string;
  purpose: ResourceBatchView['purpose'];
  starts_at: Date;
  expires_at: Date;
  valid_until: Date;
  reason: string;
  status: ResourceBatchView['status'];
  version: number;
  decided_by: string | null;
  decided_session_id: string | null;
  decision_reason: string | null;
}
interface Member {
  actor_id: string;
  membership_version: string;
  tenant_membership_version: string | null;
  actor_authz_version: string | null;
  display_name: string;
  existing_grant_count: number;
  grant_snapshot_hash: string | null;
  grant_diff: ResourceGrantDifference | null;
}
const DEFINITIONS = `select p.package_id,p.version package_version,p.name package_name,p.resources,p.allowed_actions,p.license_basis,
 t.preset_id,t.version preset_version,t.name preset_name,t.actions,t.max_days,t.approval_level,
 (select max(version) from platform_private.resource_package_versions where project_id=p.project_id and package_id=p.package_id) latest_package,
 (select max(version) from platform_private.resource_preset_versions where project_id=t.project_id and preset_id=t.preset_id) latest_preset
 from platform_private.resource_package_versions p join platform_private.resource_preset_versions t on t.project_id=p.project_id
 where p.project_id=$1 and p.package_id=$2 and p.version=$3 and t.preset_id=$4 and t.version=$5`;
export class ResourceBatchStore {
  constructor(
    private readonly session: ResourceAdministrationSession,
    private readonly validatePackage: ResourceAdministrationOptions['validatePackage'],
  ) {}
  async list(page: ResourceBatchesQuery): Promise<ResourceBatchesPage> {
    const ids = await this.session.client.query<{ id: string }>(
      'select id from platform_private.resource_batches where project_id=$1 and ($2::text is null or status=$2) order by created_at desc,id desc offset $3 limit $4',
      [
        this.session.project.id,
        page.status ?? null,
        page.offset,
        page.limit + 1,
      ],
    );
    const items: ResourceBatchView[] = [];
    for (const row of ids.rows.slice(0, page.limit))
      items.push(await this.#view(row.id));
    return ResourceBatchesPageSchema.parse({
      items,
      hasMore: ids.rows.length > page.limit,
    });
  }
  async withdraw(command: ResourceBatchAction): Promise<ResourceBatchView> {
    const before = await this.#view(command.batchId);
    if (before.applicantId !== this.session.human.userId)
      fail('NOT_AUTHORIZED');
    if (before.version !== command.expectedVersion) fail('VERSION_CONFLICT');
    if (before.status !== 'pending') fail('REQUEST_STATE_CONFLICT');
    await this.session.client.query(
      "update platform_private.resource_batches set status='withdrawn',version=version+1,updated_at=statement_timestamp() where id=$1",
      [command.batchId],
    );
    const after = await this.#view(command.batchId);
    await this.#audit(
      'withdraw',
      command.batchId,
      command.reason,
      before,
      after,
    );
    return after;
  }
  async #definitions(command: {
    packageId: string;
    packageVersion: number;
    presetId: string;
    presetVersion: number;
  }): Promise<Definitions> {
    const d = (
      await this.session.client.query<Definitions>(DEFINITIONS, [
        this.session.project.id,
        command.packageId,
        command.packageVersion,
        command.presetId,
        command.presetVersion,
      ])
    ).rows[0];
    if (!d) fail('RESOURCE_UNAVAILABLE');
    return d;
  }
  #current(d: Definitions) {
    if (
      d.package_version !== d.latest_package ||
      d.preset_version !== d.latest_preset
    )
      fail('VERSION_CONFLICT');
    if (!d.actions.every((a) => d.allowed_actions.includes(a)))
      fail('VALIDATION_FAILED');
  }
  async #now(): Promise<Date> {
    return (
      await this.session.client.query<{ now: Date }>(
        'select statement_timestamp() now',
      )
    ).rows[0]!.now;
  }
  async #validate(
    d: Definitions,
    reason: string,
    managementPermit: ResourceManagementPermit,
  ) {
    const command = ResourcePackageCommandSchema.parse({
      projectId: this.session.project.id,
      packageId: d.package_id,
      expectedVersion: d.package_version,
      name: d.package_name,
      resources: d.resources,
      allowedActions: d.actions,
      licenseBasis: d.license_basis,
      reason,
    });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const valid = await Promise.race([
        this.validatePackage({
          context: this.session.context,
          managementPermit,
          command,
          signal: controller.signal,
        }),
        new Promise<boolean>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(Error('unavailable'));
          }, 5000);
        }),
      ]);
      if (!valid) fail('RESOURCE_UNAVAILABLE');
    } catch {
      fail('RESOURCE_UNAVAILABLE');
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }
  async #members(
    ids: readonly string[],
    expiresAt: Date,
    purpose: ResourceBatchView['purpose'],
  ): Promise<readonly Member[]> {
    return (
      await this.session.client.query<Member>(
        `select m.actor_id,m.membership_version,tm.membership_version tenant_membership_version,a.authz_version actor_authz_version,
    coalesce(nullif(p.display_name,''),u.email,m.actor_id::text) display_name,
    (select count(*)::int from platform_private.resource_grants g where g.project_id=m.project_id and g.actor_id=m.actor_id and g.purpose=$5 and g.expires_at>statement_timestamp() and not exists(select 1 from platform_private.resource_revocations r where r.grant_id=g.id)) existing_grant_count
    from platform.project_memberships m join platform.tenant_memberships tm on tm.tenant_id=m.tenant_id and tm.actor_id=m.actor_id
    join platform.actors a on a.id=m.actor_id left join platform.user_profiles p on p.actor_id=a.id left join auth.users u on u.id=a.auth_user_id
    where m.project_id=$1 and m.tenant_id=$2 and m.actor_id=any($3::uuid[]) and a.status='active' and a.actor_type='human'
    and m.status='active' and tm.status='active' and m.effective_at<=statement_timestamp() and tm.effective_at<=statement_timestamp()
    and (m.expires_at is null or m.expires_at >= $4) and (tm.expires_at is null or tm.expires_at >= $4)`,
        [
          this.session.project.id,
          this.session.project.tenant_id,
          ids,
          expiresAt.toISOString(),
          purpose,
        ],
      )
    ).rows;
  }
  async #grantSnapshot(
    actorId: string,
    d: Definitions,
    startsAt: Date,
    expiresAt: Date,
    purpose: ResourceBatchView['purpose'],
    policyFingerprint: string,
  ) {
    const result = await this.session.client.query<{
      id: string;
      resources: ResourcePackageCommand['resources'];
      actions: ResourceAccessAction[];
      starts_at: Date;
      expires_at: Date;
    }>(
      `select g.id,p.resources,t.actions,g.starts_at,g.expires_at from platform_private.resource_grants g
       join platform_private.resource_package_versions p on (p.project_id,p.package_id,p.version)=(g.project_id,g.package_id,g.package_version)
       join platform_private.resource_preset_versions t on (t.project_id,t.preset_id,t.version)=(g.project_id,g.preset_id,g.preset_version)
       where g.project_id=$1 and g.actor_id=$2 and g.purpose=$5 and g.starts_at<$4 and g.expires_at>$3
       and not exists(select 1 from platform_private.resource_revocations r where r.grant_id=g.id)
       order by g.id limit 1001`,
      [
        this.session.project.id,
        actorId,
        startsAt.toISOString(),
        expiresAt.toISOString(),
        purpose,
      ],
    );
    if (result.rows.length > 1000) fail('RESOURCE_UNAVAILABLE');
    const wanted = new Set(d.resources.map(resourceAccessReferenceKey));
    const grants: ResourceGrantWindow[] = result.rows
      .map((g) => ({
        id: g.id,
        resources: g.resources
          .filter((r) => wanted.has(resourceAccessReferenceKey(r)))
          .sort((a, b) =>
            resourceAccessReferenceKey(a).localeCompare(
              resourceAccessReferenceKey(b),
            ),
          ),
        actions: g.actions.filter((a) => d.actions.includes(a)).sort(),
        startsAt: g.starts_at.toISOString(),
        expiresAt: g.expires_at.toISOString(),
      }))
      .filter((g) => g.resources.length && g.actions.length);
    return {
      hash: createHash('sha256')
        .update(JSON.stringify({ purpose, policyFingerprint, grants }))
        .digest('hex'),
      diff: resourceGrantDiff({
        resources: d.resources,
        actions: d.actions as ResourceAccessAction[],
        startsAt: startsAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        grants,
      }),
    };
  }
  async #audit(
    action: string,
    id: string,
    reason: string,
    before: unknown,
    after: unknown,
  ) {
    await this.session.client.query(
      `insert into platform_private.resource_access_events(project_id,actor_id,action,subject_id,reason,before_state,after_state) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
      [
        this.session.project.id,
        this.session.human.userId,
        action,
        id,
        reason,
        JSON.stringify(before),
        JSON.stringify(after),
      ],
    );
  }
  async #batch(id: string): Promise<Batch> {
    const row = (
      await this.session.client.query<Omit<Batch, keyof Definitions>>(
        'select * from platform_private.resource_batches where id=$1 and project_id=$2 for update',
        [id, this.session.project.id],
      )
    ).rows[0];
    if (!row) fail('REQUEST_UNAVAILABLE');
    // Fixed definitions are resolved inside the same project transaction.
    const refs = (
      await this.session.client.query<{
        package_id: string;
        package_version: number;
        preset_id: string;
        preset_version: number;
      }>(
        'select package_id,package_version,preset_id,preset_version from platform_private.resource_batches where id=$1',
        [id],
      )
    ).rows[0]!;
    const definitions = await this.#definitions({
      packageId: refs.package_id,
      packageVersion: refs.package_version,
      presetId: refs.preset_id,
      presetVersion: refs.preset_version,
    });
    return { ...row, ...definitions };
  }
  async #view(id: string): Promise<ResourceBatchView> {
    const b = await this.#batch(id);
    const members = (
      await this.session.client.query<
        Member & {
          grant_id: string | null;
          error_code: string | null;
          attempt: number | null;
        }
      >(
        `select m.*,a.grant_id,a.error_code,a.attempt from platform_private.resource_batch_members m
    left join lateral(select grant_id,error_code,attempt from platform_private.resource_batch_attempts where batch_id=m.batch_id and actor_id=m.actor_id order by attempt desc limit 1)a on true
    where m.batch_id=$1 order by m.ordinal`,
        [id],
      )
    ).rows;
    return ResourceBatchViewSchema.parse({
      id: b.id,
      projectId: b.project_id,
      version: b.version,
      status: b.status,
      packageId: b.package_id,
      packageVersion: b.package_version,
      packageName: b.package_name,
      presetId: b.preset_id,
      presetVersion: b.preset_version,
      presetName: b.preset_name,
      resourceCount: b.resources.length,
      actions: b.actions,
      approvalLevel: b.approval_level,
      purpose: b.purpose,
      startsAt: b.starts_at.toISOString(),
      expiresAt: b.expires_at.toISOString(),
      validUntil: b.valid_until.toISOString(),
      applicantId: b.applicant_id,
      decidedBy: b.decided_by,
      reason: b.reason,
      decisionReason: b.decision_reason,
      members: members.map((m) => ({
        actorId: m.actor_id,
        displayName: m.display_name,
        membershipVersion: Number(m.membership_version),
        existingGrantCount: m.existing_grant_count,
        diff: m.grant_diff
          ? ResourceGrantDifferenceSchema.parse(m.grant_diff)
          : null,
        status: m.grant_id ? 'granted' : m.error_code ? 'failed' : 'pending',
        grantId: m.grant_id,
        code: m.error_code,
        attempts: m.attempt ?? 0,
      })),
    });
  }
  async preview(
    command: ResourceBatchPreviewCommand,
    provenance?: { renewalOf: string; previousExpiresAt: string },
  ): Promise<ResourceBatchView> {
    const d = await this.#definitions(command);
    this.#current(d);
    const now = await this.#now(),
      start = new Date(command.startsAt),
      end = new Date(command.expiresAt);
    if (
      end <= now ||
      start.getTime() < now.getTime() - 300000 ||
      end.getTime() - start.getTime() > d.max_days * 86400000
    )
      fail('VALIDATION_FAILED');
    const members = await this.#members(command.actorIds, end, command.purpose);
    if (members.length !== command.actorIds.length) fail('MEMBERSHIP_CHANGED');
    const managementPermit = await assertResourceManagementPolicy(
      this.session,
      d.resources,
      d.actions as ResourceAccessAction[],
      {
        startsAt: command.startsAt,
        expiresAt: command.expiresAt,
      },
    );
    await this.#validate(d, command.reason, managementPermit);
    const id = randomUUID();
    await this.session.client.query(
      `insert into platform_private.resource_batches(id,project_id,package_id,package_version,preset_id,preset_version,applicant_id,purpose,starts_at,expires_at,valid_until,reason) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        this.session.project.id,
        command.packageId,
        command.packageVersion,
        command.presetId,
        command.presetVersion,
        this.session.human.userId,
        command.purpose,
        command.startsAt,
        command.expiresAt,
        new Date(Math.min(now.getTime() + 900000, end.getTime())).toISOString(),
        command.reason,
      ],
    );
    for (const [index, actor] of command.actorIds.entries()) {
      const m = members.find((m) => m.actor_id === actor)!;
      const snapshot = await this.#grantSnapshot(
        actor,
        d,
        start,
        end,
        command.purpose,
        managementPermit.policyFingerprint,
      );
      await this.session.client.query(
        `insert into platform_private.resource_batch_members(batch_id,project_id,actor_id,ordinal,membership_version,display_name,existing_grant_count,tenant_membership_version,actor_authz_version,grant_snapshot_hash,grant_diff) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [
          id,
          this.session.project.id,
          actor,
          index + 1,
          m.membership_version,
          m.display_name,
          m.existing_grant_count,
          m.tenant_membership_version,
          m.actor_authz_version,
          snapshot.hash,
          JSON.stringify(snapshot.diff),
        ],
      );
    }
    const result = await this.#view(id);
    await this.#audit('preview', id, command.reason, provenance ?? {}, result);
    return result;
  }
  async #important(actorId: string, level: Definitions['approval_level']) {
    if (level !== 'important') return;
    const allowed = await this.session.client.query(
      `select 1 from platform_private.resource_approval_roles policy join platform.role_bindings b on b.role_id=policy.role_id and b.actor_id=$2
    join platform.roles r on r.id=b.role_id and r.status='active'
    where policy.project_id=$1 and policy.active and b.tenant_id=$3 and (b.project_id=$1 or b.project_id is null) and b.status='active'
    and b.effective_at<=statement_timestamp() and (b.expires_at is null or b.expires_at>statement_timestamp()) limit 1`,
      [this.session.project.id, actorId, this.session.project.tenant_id],
    );
    if (!allowed.rows.length) fail('IMPORTANT_APPROVAL_REQUIRED');
  }
  async decide(command: ResourceBatchDecision): Promise<ResourceBatchView> {
    const b = await this.#batch(command.batchId),
      before = await this.#view(b.id);
    if (b.version !== command.expectedVersion) fail('VERSION_CONFLICT');
    if (
      b.applicant_id === this.session.human.userId ||
      before.members.some((m) => m.actorId === this.session.human.userId)
    )
      fail('SELF_CHANGE_FORBIDDEN');
    if (b.status !== 'pending') fail('REQUEST_STATE_CONFLICT');
    if (command.decision === 'approve') {
      this.#current(b);
      if (b.valid_until <= (await this.#now())) fail('PREVIEW_EXPIRED');
      const managementPermit = await assertResourceManagementPolicy(
        this.session,
        b.resources,
        b.actions as ResourceAccessAction[],
        {
          startsAt: b.starts_at.toISOString(),
          expiresAt: b.expires_at.toISOString(),
        },
      );
      await this.#important(this.session.human.userId, b.approval_level);
      const members = await this.session.client.query<Member>(
        'select * from platform_private.resource_batch_members where batch_id=$1 order by ordinal',
        [b.id],
      );
      for (const m of members.rows) {
        if (
          !m.grant_snapshot_hash ||
          m.grant_snapshot_hash !==
            (
              await this.#grantSnapshot(
                m.actor_id,
                b,
                b.starts_at,
                b.expires_at,
                b.purpose,
                managementPermit.policyFingerprint,
              )
            ).hash
        )
          fail('PREVIEW_CHANGED');
      }
    }
    await this.session.client.query(
      `update platform_private.resource_batches set status=$2,version=version+1,decided_by=$3,decided_session_id=$4,decision_reason=$5,decided_at=statement_timestamp(),updated_at=statement_timestamp() where id=$1`,
      [
        b.id,
        command.decision === 'approve' ? 'approved' : 'rejected',
        this.session.human.userId,
        this.session.human.sessionId,
        command.reason,
      ],
    );
    const after = await this.#view(b.id);
    await this.#audit(command.decision, b.id, command.reason, before, after);
    return after;
  }
  async execute(command: ResourceBatchAction): Promise<ResourceBatchView> {
    const b = await this.#batch(command.batchId),
      before = await this.#view(b.id);
    if (b.version !== command.expectedVersion) fail('VERSION_CONFLICT');
    if (!['approved', 'partial'].includes(b.status))
      fail('REQUEST_STATE_CONFLICT');
    this.#current(b);
    if (b.valid_until <= (await this.#now())) fail('PREVIEW_EXPIRED');
    if (!b.decided_by || !b.decided_session_id) fail('AUTHORITY_CHANGED');
    const live = await this.session.client.query(
      `select 1 from auth.sessions s join platform.actors a on a.auth_user_id=s.user_id where a.id=$1 and a.status='active' and s.id=$2 and s.oauth_client_id is null and(s.not_after is null or s.not_after>statement_timestamp())`,
      [b.decided_by, b.decided_session_id],
    );
    if (!live.rows.length) fail('AUTHORITY_CHANGED');
    const approval = await createPostgresAuthorizationContextLoader(
      (sql, values) => this.session.client.query<AuthorizationRow>(sql, values),
    )({
      actorId: b.decided_by,
      sessionId: b.decided_session_id,
      tenantId: this.session.project.tenant_id,
      projectId: b.project_id,
      purpose: b.purpose,
    });
    if (!approval?.scopes.includes('platform.access.approve'))
      fail('AUTHORITY_CHANGED');
    await this.#important(b.decided_by, b.approval_level);
    const window = {
      startsAt: b.starts_at.toISOString(),
      expiresAt: b.expires_at.toISOString(),
    };
    const managementPermit = await assertResourceManagementPolicy(
      this.session,
      b.resources,
      b.actions as ResourceAccessAction[],
      window,
    );
    await assertResourceManagementPolicy(
      {
        client: this.session.client,
        context: {
          ...this.session.context,
          principal: {
            actorType: 'human',
            actorId: b.decided_by,
            authUserId: b.decided_by,
            sessionId: b.decided_session_id,
            authenticationMethod: 'supabase_jwt',
          },
          authorization: approval,
        },
      },
      b.resources,
      b.actions as ResourceAccessAction[],
      window,
    );
    await this.#validate(b, command.reason, managementPermit);
    const original = (
      await this.session.client.query<Member>(
        'select * from platform_private.resource_batch_members where batch_id=$1 order by ordinal',
        [b.id],
      )
    ).rows;
    const current = await this.#members(
      original.map((m) => m.actor_id),
      b.expires_at,
      b.purpose,
    );
    for (const previous of before.members) {
      if (previous.status === 'granted') continue;
      const expected = original.find((m) => m.actor_id === previous.actorId)!,
        actual = current.find((m) => m.actor_id === previous.actorId);
      let code: string | null = null,
        grantId: string | null = null;
      if (
        !actual ||
        expected.tenant_membership_version === null ||
        expected.actor_authz_version === null ||
        String(expected.membership_version) !==
          String(actual.membership_version) ||
        String(expected.tenant_membership_version) !==
          String(actual.tenant_membership_version) ||
        String(expected.actor_authz_version) !==
          String(actual.actor_authz_version)
      )
        code = 'MEMBERSHIP_CHANGED';
      else if (
        !expected.grant_snapshot_hash ||
        expected.grant_snapshot_hash !==
          (
            await this.#grantSnapshot(
              previous.actorId,
              b,
              b.starts_at,
              b.expires_at,
              b.purpose,
              managementPermit.policyFingerprint,
            )
          ).hash
      )
        code = 'ACCESS_CHANGED';
      else {
        await this.session.client.query('savepoint resource_batch_recipient');
        try {
          grantId = randomUUID();
          await this.session.client.query(
            `insert into platform_private.resource_grants(id,project_id,actor_id,package_id,package_version,preset_id,preset_version,purpose,starts_at,expires_at,created_by,approved_by,reason) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              grantId,
              b.project_id,
              previous.actorId,
              b.package_id,
              b.package_version,
              b.preset_id,
              b.preset_version,
              b.purpose,
              b.starts_at.toISOString(),
              b.expires_at.toISOString(),
              this.session.human.userId,
              b.decided_by,
              command.reason,
            ],
          );
          await this.session.client.query(
            'release savepoint resource_batch_recipient',
          );
        } catch {
          await this.session.client.query(
            'rollback to savepoint resource_batch_recipient',
          );
          await this.session.client.query(
            'release savepoint resource_batch_recipient',
          );
          grantId = null;
          code = 'EXECUTION_FAILED';
        }
      }
      await this.session.client.query(
        `insert into platform_private.resource_batch_attempts(batch_id,project_id,actor_id,attempt,executed_by,grant_id,error_code) values($1,$2,$3,$4,$5,$6,$7)`,
        [
          b.id,
          b.project_id,
          previous.actorId,
          previous.attempts + 1,
          this.session.human.userId,
          grantId,
          code,
        ],
      );
    }
    const results = await this.#view(b.id),
      status = results.members.every((m) => m.status === 'granted')
        ? 'executed'
        : 'partial';
    await this.session.client.query(
      'update platform_private.resource_batches set status=$2,version=version+1,updated_at=statement_timestamp() where id=$1',
      [b.id, status],
    );
    const after = await this.#view(b.id);
    await this.#audit(
      status === 'executed' ? 'grant' : 'execute.failed',
      b.id,
      command.reason,
      before,
      after,
    );
    return after;
  }
}
