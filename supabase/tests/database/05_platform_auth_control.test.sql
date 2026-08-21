begin;

select plan(53);

select has_schema('platform', 'platform control schema exists');
select has_schema('platform_private', 'platform private schema exists');

select has_table('platform', 'actors', 'actors table exists');
select has_table('platform', 'user_profiles', 'user profiles table exists');
select has_table('platform', 'tenants', 'tenants table exists');
select has_table('platform', 'tenant_memberships', 'tenant memberships table exists');
select has_table('platform', 'projects', 'projects table exists');
select has_table('platform', 'project_memberships', 'project memberships table exists');
select has_table('platform', 'roles', 'roles table exists');
select has_table('platform', 'role_scopes', 'role scopes table exists');
select has_table('platform', 'role_bindings', 'role bindings table exists');
select has_table('platform', 'delegations', 'delegations table exists');
select has_table(
  'platform_private',
  'delegated_credentials',
  'private delegated credentials table exists'
);
select has_table(
  'platform_private',
  'authorization_audit_events',
  'private authorization audit table exists'
);
select has_table(
  'platform_private',
  'control_outbox',
  'private control outbox exists'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'platform'
      and table_name = 'roles'
      and column_name = 'max_security_level'
      and is_nullable = 'NO'
      and column_default = '''L0_PUBLIC''::text'
  ),
  1::bigint,
  'roles define a fail-closed security-level ceiling'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'platform'
      and table_name = 'delegations'
      and column_name = 'version'
      and is_nullable = 'NO'
      and column_default = '1'
  ),
  1::bigint,
  'delegations expose an optimistic concurrency version'
);
select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'platform_private'
      and table_name = 'delegated_credentials'
      and column_name = 'hmac_key_id'
      and is_nullable = 'NO'
  ),
  1::bigint,
  'delegated credentials identify the server HMAC key'
);

select has_function(
  'platform_private',
  'handle_new_auth_user',
  array[]::text[],
  'auth user provisioning function exists'
);
select has_trigger(
  'auth',
  'users',
  'wiser_auth_user_provisioning',
  'auth user provisioning trigger is attached'
);

select is(
  (
    select count(*)
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'platform'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and c.relforcerowsecurity
  ),
  10::bigint,
  'every platform table has forced RLS'
);
select is(
  (
    select count(*)
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'platform_private'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and c.relforcerowsecurity
  ),
  3::bigint,
  'every private platform table has forced RLS'
);

select ok(
  not has_schema_privilege('anon', 'platform', 'usage'),
  'anonymous clients cannot enter the platform schema'
);
select ok(
  not has_schema_privilege('authenticated', 'platform', 'usage'),
  'authenticated clients cannot bypass Fastify through the platform schema'
);
select ok(
  not has_schema_privilege('anon', 'platform_private', 'usage'),
  'anonymous clients cannot enter the private platform schema'
);
select ok(
  not has_schema_privilege('authenticated', 'platform_private', 'usage'),
  'authenticated clients cannot enter the private platform schema'
);
select ok(
  not has_function_privilege(
    'public',
    'platform_private.handle_new_auth_user()',
    'execute'
  ),
  'the auth provisioning function is not public API'
);

select is(
  (
    select count(*)
    from platform.actors
    where id = '10000000-0000-4000-8000-000000000001'
      and actor_type = 'human'
      and auth_user_id = id
  ),
  1::bigint,
  'seeded Supabase users are provisioned as human actors'
);
select is(
  (
    select count(*)
    from platform.user_profiles
    where actor_id = '10000000-0000-4000-8000-000000000001'
      and default_locale = 'zh-CN'
  ),
  1::bigint,
  'seeded Supabase users receive a platform profile'
);
select is(
  (
    select count(*)
    from platform.tenants
    where id = 'b1000000-0000-4000-8000-000000000001'
      and slug = 'wiser-local'
      and status = 'active'
  ),
  1::bigint,
  'the local WISER tenant is seeded'
);
select is(
  (
    select count(*)
    from platform.projects
    where id = 'b2000000-0000-4000-8000-000000000001'
      and tenant_id = 'b1000000-0000-4000-8000-000000000001'
      and slug = 'yongding-lab'
  ),
  1::bigint,
  'the local Yongding project is seeded'
);
select is(
  (
    select count(*)
    from platform.tenant_memberships
    where tenant_id = 'b1000000-0000-4000-8000-000000000001'
      and status = 'active'
  ),
  5::bigint,
  'all five seeded users belong to the WISER tenant'
);
select is(
  (
    select count(*)
    from platform.project_memberships
    where project_id = 'b2000000-0000-4000-8000-000000000001'
      and status = 'active'
  ),
  5::bigint,
  'all five seeded users belong to the Yongding project'
);
select is(
  (
    select count(*)
    from platform.role_bindings
    where actor_id = '10000000-0000-4000-8000-000000000005'
      and status = 'active'
  ),
  3::bigint,
  'the seeded operator has platform EXCON and data stewardship roles'
);
select is(
  (
    select count(distinct role_scope.scope)
    from platform.roles as role
    join platform.role_scopes as role_scope on role_scope.role_id = role.id
    where role.role_key = 'data-steward'
      and role_scope.scope = any(
        array[
          'data.catalog.read',
          'data.geo.read',
          'data.graph.read',
          'data.ingestion.write',
          'data.knowledge.read',
          'data.operation.read',
          'data.publish',
          'data.query.execute',
          'data.search.execute'
        ]::text[]
      )
  ),
  9::bigint,
  'the data steward covers every initial Capability Registry scope'
);

select throws_ok(
  $$insert into platform.actors (id, actor_type, status)
    values ('a1000000-0000-4000-8000-000000000001', 'human', 'active')$$,
  '23514'::char(5),
  null,
  'human actors require the matching Supabase auth user id'
);

insert into platform.tenants (
  id, slug, name_zh_cn, name_en, status, created_by_actor_id
) values
  (
    'a2000000-0000-4000-8000-000000000001',
    'tenant-a',
    '租户 A',
    'Tenant A',
    'active',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    'a2000000-0000-4000-8000-000000000002',
    'tenant-b',
    '租户 B',
    'Tenant B',
    'active',
    '10000000-0000-4000-8000-000000000002'
  );

insert into platform.tenant_memberships (
  tenant_id, actor_id, status, membership_version
) values
  (
    'a2000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'active',
    1
  ),
  (
    'a2000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'active',
    1
  );

insert into platform.projects (
  id, tenant_id, slug, name_zh_cn, name_en, status, created_by_actor_id
) values (
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'project-a',
  '项目 A',
  'Project A',
  'active',
  '10000000-0000-4000-8000-000000000001'
);

select throws_ok(
  $$insert into platform.project_memberships (
      project_id, tenant_id, actor_id, status, membership_version
    ) values (
      'a3000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      'active',
      1
    )$$,
  '23503'::char(5),
  null,
  'a project membership cannot splice an actor from another tenant'
);

insert into platform.roles (
  id, role_key, system_id, status
) values (
  'a4000000-0000-4000-8000-000000000001',
  'test-data-reader',
  'data',
  'active'
);

select throws_ok(
  $$insert into platform.roles (
      id, role_key, system_id, status, max_security_level
    ) values (
      'a4000000-0000-4000-8000-000000000002',
      'test-invalid-security-role',
      'data',
      'active',
      'L4_SECRET'
    )$$,
  '23514'::char(5),
  null,
  'role security ceilings are limited to the WISER L0-L3 scale'
);

select throws_ok(
  $$insert into platform.role_scopes (role_id, scope)
    values ('a4000000-0000-4000-8000-000000000001', 'read')$$,
  '23514'::char(5),
  null,
  'role scopes must use a namespaced capability id'
);

insert into platform.actors (
  id, actor_type, status
) values (
  'a5000000-0000-4000-8000-000000000001',
  'agent',
  'active'
);

select throws_ok(
  $$insert into platform.delegations (
      id, delegated_by_actor_id, delegate_actor_id,
      tenant_id, project_id, scopes, purpose,
      max_security_level, status, expires_at
    ) values (
      'a6000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      array['data.catalog.read'],
      'operate',
      'L1_INTERNAL',
      'active',
      now() + interval '1 hour'
    )$$,
  '23514'::char(5),
  null,
  'actors cannot delegate to themselves'
);

select throws_ok(
  $$insert into platform.delegations (
      id, delegated_by_actor_id, delegate_actor_id,
      tenant_id, project_id, scopes, purpose,
      max_security_level, status, expires_at, revoked_at
    ) values (
      'a6000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      array['data.catalog.read'],
      'operate',
      'L1_INTERNAL',
      'active',
      now() + interval '1 hour',
      now()
    )$$,
  '23514'::char(5),
  null,
  'an active delegation cannot carry a revocation timestamp'
);

select throws_ok(
  $$insert into platform.delegations (
      id, delegated_by_actor_id, delegate_actor_id,
      tenant_id, project_id, scopes, purpose,
      max_security_level, status, expires_at
    ) values (
      'a6000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      array['data.catalog.read'],
      'operate',
      'L1_INTERNAL',
      'revoked',
      now() + interval '1 hour'
    )$$,
  '23514'::char(5),
  null,
  'a revoked delegation requires a revocation timestamp'
);

insert into platform.delegations (
  id, delegated_by_actor_id, delegate_actor_id,
  tenant_id, project_id, scopes, purpose,
  max_security_level, status, expires_at
) values (
  'a6000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  array['data.catalog.read'],
  'operate',
  'L1_INTERNAL',
  'active',
  now() + interval '1 hour'
);

select throws_ok(
  $$insert into platform_private.delegated_credentials (
      id, delegation_id, key_id, hmac_key_id, token_hmac, expires_at
    ) values (
      'a7000000-0000-4000-8000-000000000001',
      'a6000000-0000-4000-8000-000000000002',
      'wdc_test_invalid',
      'primary-2026-08',
      decode('aa', 'hex'),
      now() + interval '1 hour'
    )$$,
  '23514'::char(5),
  null,
  'delegated credentials require a 256-bit HMAC'
);

select throws_ok(
  $$insert into platform_private.delegated_credentials (
      id, delegation_id, key_id, hmac_key_id, token_hmac, expires_at
    ) values (
      'a7000000-0000-4000-8000-000000000002',
      'a6000000-0000-4000-8000-000000000002',
      'wdc_0123456789ABCDEFGHIJKL',
      'Invalid Key Id',
      decode(repeat('ab', 32), 'hex'),
      now() + interval '30 minutes'
    )$$,
  '23514'::char(5),
  null,
  'delegated credential HMAC key ids use a strict operational identifier'
);

select lives_ok(
  $$insert into platform_private.delegated_credentials (
      id, delegation_id, key_id, hmac_key_id, token_hmac, expires_at
    ) values (
      'a7000000-0000-4000-8000-000000000003',
      'a6000000-0000-4000-8000-000000000002',
      'wdc_0123456789abcdefghijKL',
      'primary-2026-08',
      decode(repeat('cd', 32), 'hex'),
      now() + interval '30 minutes'
    )$$,
  'a valid delegated credential records its HMAC key id'
);

select throws_ok(
  $$update platform_private.delegated_credentials
    set rotated_to_credential_id = id
    where id = 'a7000000-0000-4000-8000-000000000003'$$,
  '23514'::char(5),
  null,
  'a delegated credential cannot rotate to itself'
);

select throws_ok(
  $$update platform_private.delegated_credentials
    set rotated_to_credential_id = 'a7000000-0000-4000-8000-000000000001'
    where id = 'a7000000-0000-4000-8000-000000000003'$$,
  '23514'::char(5),
  null,
  'a rotated delegated credential must already be revoked'
);

select throws_ok(
  $$update platform_private.delegated_credentials
    set revoked_at = created_at - interval '1 second'
    where id = 'a7000000-0000-4000-8000-000000000003'$$,
  '23514'::char(5),
  null,
  'credential revocation cannot predate credential creation'
);

select is(
  (
    select c.confdeltype
    from pg_constraint as c
    where c.conrelid = 'platform_private.delegated_credentials'::regclass
      and c.confrelid = 'platform.delegations'::regclass
      and c.contype = 'f'
  ),
  'r'::"char",
  'delegation deletion cannot erase credential security facts'
);

select has_index(
  'platform_private',
  'delegated_credentials',
  'delegated_credentials_one_active_idx',
  'only one active credential is allowed per delegation'
);
select has_index(
  'platform',
  'tenant_memberships',
  'tenant_memberships_actor_status_idx',
  'tenant membership lookups by actor and status are indexed'
);
select has_index(
  'platform',
  'project_memberships',
  'project_memberships_actor_status_idx',
  'project membership lookups by actor and status are indexed'
);

select is(
  (
    select count(*)
    from pg_constraint as c
    join pg_attribute as a
      on a.attrelid = c.conrelid
      and a.attnum = any(c.conkey)
    where c.contype = 'f'
      and c.connamespace in (
        'platform'::regnamespace,
        'platform_private'::regnamespace
      )
      and not exists (
        select 1
        from pg_index as i
        where i.indrelid = c.conrelid
          and (i.indkey::smallint[])[0:cardinality(c.conkey) - 1] = c.conkey
      )
  ),
  0::bigint,
  'every platform foreign-key column set is indexed'
);

select * from finish();
rollback;
