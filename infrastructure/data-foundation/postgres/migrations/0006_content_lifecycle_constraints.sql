update catalog.asset
set lifecycle_state = 'FINGERPRINTED',
  row_version = row_version + 1,
  updated_at = clock_timestamp()
where lifecycle_state = 'QUARANTINED'
  and version_id is null
  and content_hash is not null
  and content_blob_id is not null;

alter table catalog.asset
  add constraint asset_lifecycle_state_check check (
    lifecycle_state in ('QUARANTINED', 'FINGERPRINTED', 'RAW')
    and (
      (
        lifecycle_state = 'QUARANTINED'
        and version_id is null
        and content_hash is null
        and content_blob_id is null
      )
      or (
        lifecycle_state = 'FINGERPRINTED'
        and version_id is null
        and content_hash is not null
        and content_blob_id is not null
      )
      or (
        lifecycle_state = 'RAW'
        and version_id is not null
        and content_hash is not null
        and content_blob_id is not null
      )
    )
  );

alter table catalog.content_blob
  drop constraint content_blob_lifecycle,
  add constraint content_blob_storage_state_check check (
    (
      lifecycle_state = 'FINGERPRINTED'
      and raw_storage_key is null
    )
    or (
      lifecycle_state = 'RAW'
      and raw_storage_key is not null
    )
  );
