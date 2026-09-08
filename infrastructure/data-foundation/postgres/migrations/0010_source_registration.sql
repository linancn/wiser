-- A declared source profile is an immutable input to the normal ingestion flow.
-- It carries no credentials and cannot assert analytical quality or publication.
alter table ingestion.session add column source_registration jsonb;
alter table ingestion.session add constraint ingestion_source_registration_shape
  check (source_registration is null or (
    jsonb_typeof(source_registration) = 'object'
    and octet_length(source_registration::text) <= 65536
    and source_registration ?& array['sourceId','kind','name','bundleId',
      'providerName','accessStatus','completeness','manifestAssetId',
      'manifestSha256','limitations']
    and source_registration ->> 'kind' in
      ('PROVIDER','DATASET_INTERFACE','CATALOG_ENTRY','FILE_COLLECTION')
    and source_registration ->> 'completeness' in
      ('UNKNOWN','NOT_A_DATASET','SAMPLE','PARTIAL','EMPTY')
    and source_registration ->> 'manifestSha256' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(source_registration -> 'limitations') = 'array'
    and not (source_registration ?| array['qualityGrade','acceptanceStatus',
      'publicationStatus','credentials','token','password'])
  ));

create function ingestion.guard_source_registration()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if new.source_registration is distinct from old.source_registration then
    raise exception 'source registration is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger ingestion_source_registration_guard before update on ingestion.session
  for each row execute function ingestion.guard_source_registration();
revoke all on function ingestion.guard_source_registration() from public;
