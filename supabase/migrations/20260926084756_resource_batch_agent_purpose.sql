-- Add an explicit, independently approved MCP purpose without changing old grants.
begin;
set local lock_timeout = '5s';
alter table platform_private.resource_batches
  drop constraint resource_batches_purpose_check,
  add constraint resource_batches_purpose_check
    check (purpose in ('web-console', 'agent-data'));
commit;
