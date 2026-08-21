create table catalog.content_blob (
  content_blob_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  content_hash bytea not null,
  byte_size bigint not null,
  raw_storage_key text,
  lifecycle_state text not null default 'FINGERPRINTED',
  security_level text not null,
  policy_version bigint not null default 1,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint content_blob_hash_size check (
    octet_length(content_hash) = 32 and byte_size >= 0
  ),
  constraint content_blob_security_level check (
    security.is_valid_security_level(security_level)
  ),
  constraint content_blob_lifecycle check (
    lifecycle_state in ('FINGERPRINTED', 'RAW')
  ),
  constraint content_blob_row_version check (row_version > 0),
  unique (tenant_id, project_id, content_blob_id),
  unique (tenant_id, project_id, content_hash)
);

create unique index content_blob_raw_storage_key_unique
  on catalog.content_blob (tenant_id, project_id, raw_storage_key)
  where raw_storage_key is not null;

alter table catalog.asset
  drop constraint asset_hash_size,
  drop constraint asset_immutable_version,
  drop constraint if exists asset_tenant_id_project_id_content_hash_key,
  alter column content_hash drop not null,
  add column content_blob_id uuid,
  add constraint asset_hash_size check (
    byte_size >= 0
    and (content_hash is null or octet_length(content_hash) = 32)
  ),
  add constraint asset_row_version_positive check (row_version > 0),
  add constraint asset_content_blob_fk
    foreign key (tenant_id, project_id, content_blob_id)
    references catalog.content_blob (tenant_id, project_id, content_blob_id);

create index asset_content_hash_idx
  on catalog.asset (tenant_id, project_id, content_hash)
  where content_hash is not null;

insert into catalog.content_blob (
  tenant_id,
  project_id,
  content_hash,
  byte_size,
  raw_storage_key,
  lifecycle_state,
  security_level,
  policy_version,
  row_version,
  created_at,
  updated_at
)
select
  asset.tenant_id,
  asset.project_id,
  asset.content_hash,
  asset.byte_size,
  case
    when asset.lifecycle_state in ('RAW', 'VERSIONED') then asset.storage_key
    else null
  end,
  case
    when asset.lifecycle_state in ('RAW', 'VERSIONED') then 'RAW'
    else 'FINGERPRINTED'
  end,
  asset.security_level,
  asset.policy_version,
  1,
  asset.created_at,
  asset.updated_at
from catalog.asset as asset
where asset.content_hash is not null
on conflict (tenant_id, project_id, content_hash) do nothing;

update catalog.asset as asset
set content_blob_id = blob.content_blob_id
from catalog.content_blob as blob
where blob.tenant_id = asset.tenant_id
  and blob.project_id = asset.project_id
  and blob.content_hash = asset.content_hash
  and asset.content_hash is not null;

alter table ingestion.input_asset
  add constraint input_asset_one_ingestion_per_asset
  unique (tenant_id, project_id, asset_id);

alter table catalog.content_blob enable row level security;
alter table catalog.content_blob force row level security;

create policy data_scope on catalog.content_blob
using (
  security.authorized_row(
    tenant_id,
    project_id,
    security_level,
    policy_version
  )
)
with check (
  security.authorized_row(
    tenant_id,
    project_id,
    security_level,
    policy_version
  )
);

drop trigger asset_content_immutable on catalog.asset;

create or replace function event.enforce_asset_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'asset rows are immutable facts and cannot be deleted'
      using errcode = '55000';
  end if;

  if old.version_id is not null then
    raise exception 'a version-bound asset is immutable'
      using errcode = '55000';
  end if;
  if old.content_hash is not null
    and new.content_hash is distinct from old.content_hash then
    raise exception 'an authoritative asset hash cannot change'
      using errcode = '55000';
  end if;
  if old.content_blob_id is not null
    and new.content_blob_id is distinct from old.content_blob_id then
    raise exception 'an authoritative content blob binding cannot change'
      using errcode = '55000';
  end if;
  if security.security_rank(new.security_level)
    < security.security_rank(old.security_level) then
    raise exception 'asset security cannot be lowered'
      using errcode = '42501';
  end if;
  if new.row_version <> old.row_version + 1 then
    raise exception 'asset row version must advance by one'
      using errcode = '40001';
  end if;
  if old.storage_key is distinct from new.storage_key
    and new.version_id is null then
    raise exception 'asset storage can change only during version binding'
      using errcode = '55000';
  end if;
  if old.lifecycle_state = 'QUARANTINED'
    and new.lifecycle_state not in ('QUARANTINED', 'FINGERPRINTED') then
    raise exception 'invalid asset lifecycle transition'
      using errcode = '55000';
  end if;
  if old.lifecycle_state = 'FINGERPRINTED'
    and new.lifecycle_state not in ('FINGERPRINTED', 'RAW') then
    raise exception 'invalid asset lifecycle transition'
      using errcode = '55000';
  end if;
  if new.version_id is not null
    and (
      new.lifecycle_state <> 'RAW'
      or new.content_hash is null
      or new.content_blob_id is null
    ) then
    raise exception 'a version-bound asset requires immutable content facts'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger asset_lifecycle_guard
before update or delete on catalog.asset
for each row execute function event.enforce_asset_lifecycle();

create or replace function event.enforce_content_blob_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'content blobs are immutable facts and cannot be deleted'
      using errcode = '55000';
  end if;
  if new.content_hash <> old.content_hash
    or new.byte_size <> old.byte_size then
    raise exception 'content blob identity cannot change'
      using errcode = '55000';
  end if;
  if old.raw_storage_key is not null
    and new.raw_storage_key is distinct from old.raw_storage_key then
    raise exception 'raw content storage is immutable'
      using errcode = '55000';
  end if;
  if security.security_rank(new.security_level)
    < security.security_rank(old.security_level) then
    raise exception 'content blob security cannot be lowered'
      using errcode = '42501';
  end if;
  if new.row_version <> old.row_version + 1 then
    raise exception 'content blob row version must advance by one'
      using errcode = '40001';
  end if;
  if old.lifecycle_state = 'RAW' and new.lifecycle_state <> 'RAW' then
    raise exception 'raw content blobs are immutable'
      using errcode = '55000';
  end if;
  if new.lifecycle_state = 'RAW' and new.raw_storage_key is null then
    raise exception 'raw content blobs require a storage key'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger content_blob_lifecycle_guard
before update or delete on catalog.content_blob
for each row execute function event.enforce_content_blob_lifecycle();

revoke all on table catalog.content_blob from public;
revoke all on function event.enforce_asset_lifecycle() from public;
revoke all on function event.enforce_content_blob_lifecycle() from public;
