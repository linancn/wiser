create or replace function catalog.guard_data_item_version_publication()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'data item versions are immutable and cannot be deleted'
      using errcode = '55000';
  end if;

  if old.publication_status = 'UNPUBLISHED'
    and new.publication_status = 'PUBLISHED'
    and old.published_at is null
    and new.published_at is not null
    and new.published_at >= old.committed_at
    and new.updated_at >= old.updated_at
    and new.version_id is not distinct from old.version_id
    and new.tenant_id is not distinct from old.tenant_id
    and new.project_id is not distinct from old.project_id
    and new.data_item_id is not distinct from old.data_item_id
    and new.version_number is not distinct from old.version_number
    and new.asset_manifest is not distinct from old.asset_manifest
    and new.source_hash is not distinct from old.source_hash
    and new.metadata_hash is not distinct from old.metadata_hash
    and new.schema_version_id is not distinct from old.schema_version_id
    and new.processing_stage is not distinct from old.processing_stage
    and new.generation_method is not distinct from old.generation_method
    and new.quality_grade is not distinct from old.quality_grade
    and new.acceptance_status is not distinct from old.acceptance_status
    and new.security_level is not distinct from old.security_level
    and new.supersedes_version_id is not distinct from old.supersedes_version_id
    and new.policy_version is not distinct from old.policy_version
    and new.row_version is not distinct from old.row_version
    and new.created_at is not distinct from old.created_at
    and new.committed_at is not distinct from old.committed_at
  then
    return new;
  end if;

  raise exception 'data item version content and lifecycle are immutable'
    using errcode = '55000';
end;
$$;

drop trigger data_item_version_immutable on catalog.data_item_version;

create trigger data_item_version_publication_guard
before update or delete on catalog.data_item_version
for each row execute function catalog.guard_data_item_version_publication();
