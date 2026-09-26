import {
  ResourceGrantsPageSchema,
  ResourceGrantRevokeReceiptSchema,
  ResourceBatchPurposeSchema,
  type ResourceGrantsQuery,
  type ResourceGrantsPage,
  type ResourceGrantRevokeCommand,
  type ResourceGrantRevokeReceipt,
  type ResourceGrantRenewCommand,
  type ResourceGrantRenewReceipt,
  type ResourceAccessAction,
} from '@wiser/platform-contracts';
import {
  ResourceBatchStore,
  type ResourceAdministrationSession,
} from './resource-batch-service.js';
import type { ResourceAdministrationOptions } from './resource-administration-service.js';
import { resourceAdministrationFailure as fail } from './resource-administration-error.js';
interface GrantRow {
  id: string;
  actor_id: string;
  package_id: string;
  package_version: number;
  package_name: string;
  preset_id: string;
  preset_version: number;
  preset_name: string;
  actions: ResourceAccessAction[];
  resource_count: number;
  purpose: string;
  starts_at: Date;
  expires_at: Date;
  status: 'active' | 'scheduled' | 'expired' | 'revoked';
  revoked_at: Date | null;
  reason: string;
  revocation_reason: string | null;
  created_by: string;
  approved_by: string;
}
const SELECT = `select g.*,p.name package_name,t.name preset_name,t.actions,jsonb_array_length(p.resources) resource_count,
 r.revoked_at,r.reason revocation_reason,
 case when r.grant_id is not null then 'revoked' when g.expires_at<=statement_timestamp() then 'expired' when g.starts_at>statement_timestamp() then 'scheduled' else 'active' end status
 from platform_private.resource_grants g
 join platform_private.resource_package_versions p on (p.project_id,p.package_id,p.version)=(g.project_id,g.package_id,g.package_version)
 join platform_private.resource_preset_versions t on (t.project_id,t.preset_id,t.version)=(g.project_id,g.preset_id,g.preset_version)
 left join platform_private.resource_revocations r on r.grant_id=g.id`;
export class ResourceGrantStore {
  constructor(
    private readonly session: ResourceAdministrationSession,
    private readonly validatePackage: ResourceAdministrationOptions['validatePackage'],
  ) {}
  async #now() {
    return (
      await this.session.client.query<{ now: Date }>(
        'select statement_timestamp() now',
      )
    ).rows[0]!.now;
  }
  async #record(id: string) {
    const row = (
      await this.session.client.query<GrantRow>(
        SELECT + ' where g.project_id=$1 and g.id=$2',
        [this.session.project.id, id],
      )
    ).rows[0];
    if (!row) fail('RESOURCE_UNAVAILABLE');
    return row;
  }
  async list(page: ResourceGrantsQuery): Promise<ResourceGrantsPage> {
    const actor = page.actorId ?? this.session.human.userId;
    if (
      actor !== this.session.human.userId &&
      !this.session.context.authorization.scopes.includes(
        'platform.membership.manage',
      )
    )
      fail('NOT_AUTHORIZED');
    const rows = await this.session.client.query<GrantRow>(
      `select * from (${SELECT} where g.project_id=$1 and g.actor_id=$2) records where ($3::text is null or status=$3) order by created_at desc,id desc offset $4 limit $5`,
      [
        this.session.project.id,
        actor,
        page.status ?? null,
        page.offset,
        page.limit + 1,
      ],
    );
    return ResourceGrantsPageSchema.parse({
      items: rows.rows.slice(0, page.limit).map((g) => ({
        id: g.id,
        actorId: g.actor_id,
        packageId: g.package_id,
        packageVersion: g.package_version,
        packageName: g.package_name,
        presetId: g.preset_id,
        presetVersion: g.preset_version,
        presetName: g.preset_name,
        actions: g.actions,
        resourceCount: g.resource_count,
        purpose: g.purpose,
        startsAt: g.starts_at.toISOString(),
        expiresAt: g.expires_at.toISOString(),
        status: g.status,
        revokedAt: g.revoked_at?.toISOString() ?? null,
        reason: g.reason,
        revocationReason: g.revocation_reason,
        createdBy: g.created_by,
        approvedBy: g.approved_by,
      })),
      hasMore: rows.rows.length > page.limit,
      checkedAt: (await this.#now()).toISOString(),
    });
  }
  async revoke(
    command: ResourceGrantRevokeCommand,
  ): Promise<ResourceGrantRevokeReceipt> {
    const g = await this.#record(command.grantId);
    let revoked = g.revoked_at;
    if (!revoked)
      revoked = (
        await this.session.client.query<{ revoked_at: Date }>(
          'insert into platform_private.resource_revocations(grant_id,project_id,revoked_by,reason) values($1,$2,$3,$4) returning revoked_at',
          [
            g.id,
            this.session.project.id,
            this.session.human.userId,
            command.reason,
          ],
        )
      ).rows[0]!.revoked_at;
    const other = (
      await this.session.client.query<{ n: number }>(
        `select count(*)::int n from platform_private.resource_grants g where g.project_id=$1 and g.actor_id=$2 and g.purpose=$3 and g.starts_at<=statement_timestamp() and g.expires_at>statement_timestamp() and not exists(select 1 from platform_private.resource_revocations r where r.grant_id=g.id)`,
        [this.session.project.id, g.actor_id, g.purpose],
      )
    ).rows[0]!.n;
    const receipt = ResourceGrantRevokeReceiptSchema.parse({
      grantId: g.id,
      revokedAt: revoked.toISOString(),
      alreadyRevoked: g.revoked_at !== null,
      otherActiveGrantCount: other,
    });
    if (!g.revoked_at)
      await this.session.client.query(
        `insert into platform_private.resource_access_events(project_id,actor_id,action,subject_id,reason,before_state,after_state) values($1,$2,'revoke',$3,$4,$5::jsonb,$6::jsonb)`,
        [
          this.session.project.id,
          this.session.human.userId,
          g.id,
          command.reason,
          JSON.stringify({
            actorId: g.actor_id,
            packageId: g.package_id,
            packageVersion: g.package_version,
            presetId: g.preset_id,
            presetVersion: g.preset_version,
            startsAt: g.starts_at.toISOString(),
            expiresAt: g.expires_at.toISOString(),
          }),
          JSON.stringify(receipt),
        ],
      );
    return receipt;
  }
  async renew(
    command: ResourceGrantRenewCommand,
  ): Promise<ResourceGrantRenewReceipt> {
    const g = await this.#record(command.grantId);
    const purpose = ResourceBatchPurposeSchema.safeParse(g.purpose);
    if (g.revoked_at || !purpose.success) fail('REQUEST_STATE_CONFLICT');
    const now = await this.#now(),
      start = new Date(Math.max(now.getTime(), g.expires_at.getTime()));
    if (Date.parse(command.expiresAt) <= start.getTime())
      fail('VALIDATION_FAILED');
    const batch = await new ResourceBatchStore(
      this.session,
      this.validatePackage,
    ).preview(
      {
        projectId: this.session.project.id,
        packageId: g.package_id,
        packageVersion: g.package_version,
        presetId: g.preset_id,
        presetVersion: g.preset_version,
        actorIds: [g.actor_id],
        purpose: purpose.data,
        startsAt: start.toISOString(),
        expiresAt: command.expiresAt,
        reason: command.reason,
      },
      { renewalOf: g.id, previousExpiresAt: g.expires_at.toISOString() },
    );
    return { previousGrantId: g.id, batch };
  }
}
