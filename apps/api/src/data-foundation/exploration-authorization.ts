export const AUTHORIZED = `with authorized as (
  select item.data_item_id, version.version_id, item.name, item.source_organization,
    version.asset_manifest, ref.ordinality, analysis.analysis_id, analysis.status analysis_status
  from jsonb_array_elements($1::jsonb) with ordinality ref(value,ordinality)
  join catalog.data_item_version version on version.version_id=(ref.value->>'versionId')::uuid
    and version.data_item_id=(ref.value->>'dataItemId')::uuid
  join catalog.data_item item on item.tenant_id=version.tenant_id and item.project_id=version.project_id and item.data_item_id=version.data_item_id
  left join service.analysis_run analysis on analysis.analysis_id=(ref.value->>'analysisId')::uuid and analysis.version_id=version.version_id and analysis.completed_at is not null
  where version.publication_status='PUBLISHED' and version.acceptance_status in ('PASSED','CONDITIONALLY_PASSED')
    and item.publication_status='PUBLISHED' and item.acceptance_status in ('PASSED','CONDITIONALLY_PASSED')
    and (ref.value->>'analysisId' is null or analysis.analysis_id is not null)
)`;
