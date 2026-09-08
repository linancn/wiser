begin;
select plan(3);
select has_column('platform_private', 'delegated_credentials', 'credential_kind', 'OAuth exchanges are explicitly distinguished from ordinary credentials');
select has_function('platform_private', 'guard_credential_kind', array[]::text[], 'Credential kind cannot change after issuance');
select has_function('platform_private', 'require_agent_exchange_binding', array[]::text[], 'Exchanged credentials require a binding before transaction commit');
select * from finish();
rollback;
