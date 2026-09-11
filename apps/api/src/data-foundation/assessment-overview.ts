import {
  AssessmentOverviewInputSchema,
  AssessmentOverviewOutputSchema,
} from '@wiser/data-contracts';
import type { PostgresDataCommandClient } from './postgres-command-executors.js';

export async function assessmentOverview(
  client: PostgresDataCommandClient,
  raw: unknown,
) {
  const input = AssessmentOverviewInputSchema.parse(raw);
  const rows = await client.query(
    `with available as materialized (
 select i.data_item_id,v.version_id,i.name,r.assessment_id,r.created_at,r.result,
   coalesce(r.result->>'nextAction','UNCHECKED') action
 from catalog.data_item i join lateral (
   select version_id from catalog.data_item_version v where v.data_item_id=i.data_item_id
    and v.publication_status='PUBLISHED' and v.acceptance_status in ('PASSED','CONDITIONALLY_PASSED')
   order by version_number desc,version_id desc limit 1
 ) v on true left join lateral (
   select r.assessment_id,r.created_at,r.result from service.intake_assessment r
   join catalog.asset a on a.asset_id=r.asset_id and a.version_id=r.version_id and a.content_hash=r.source_hash and a.lifecycle_state='RAW'
   where r.tenant_id=i.tenant_id and r.project_id=i.project_id and r.version_id=v.version_id and r.data_item_id=i.data_item_id and r.declaration->>'target'=$1
   order by r.created_at desc,r.assessment_id desc limit 1
 ) r on true
 where i.tenant_id=security.current_tenant_id() and i.project_id=security.current_project_id()
   and i.publication_status='PUBLISHED' and i.acceptance_status in ('PASSED','CONDITIONALLY_PASSED')
   and ($2::text is null or i.name ilike '%' || $2 || '%')
 ), selected as materialized (select * from available where $3::text is null or action=$3),
 page as (select * from selected where $4::uuid is null or data_item_id>$4::uuid order by data_item_id limit $5)
 select jsonb_build_object(
   'target',$1::text,'totalCount',(select count(*) from available),'checkedCount',(select count(*) from available where assessment_id is not null),
   'uncheckedCount',(select count(*) from available where assessment_id is null),'selectedCount',(select count(*) from selected),
   'counts',coalesce((select jsonb_agg(jsonb_build_object('action',action,'count',n) order by action) from (select action,count(*) n from available group by action) c),'[]'::jsonb),
   'items',coalesce((select jsonb_agg(jsonb_build_object('dataItemId',data_item_id,'versionId',version_id,'name',name,'assessmentId',assessment_id,'checkedAt',created_at,'acquisition',result->>'acquisition','access',result->>'access','coverage',result->>'coverage','nextAction',action) order by data_item_id) from page),'[]'::jsonb)
 ) value`,
    [
      input.target,
      input.query ?? null,
      input.action ?? null,
      input.after ?? null,
      input.first + 1,
    ],
  );
  const value = rows.rows[0]?.['value'] as Record<string, unknown> | undefined;
  if (!value || !Array.isArray(value['items']))
    throw Error('Invalid assessment overview');
  const all = value['items'] as unknown[];
  return AssessmentOverviewOutputSchema.parse({
    ...value,
    items: all.slice(0, input.first),
    ...(all.length > input.first
      ? {
          nextCursor: (all[input.first - 1] as Record<string, unknown>)[
            'dataItemId'
          ],
        }
      : {}),
  });
}
