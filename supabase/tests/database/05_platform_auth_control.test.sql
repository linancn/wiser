begin;

select plan(35);

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
  'data-reader',
  'data',
  'active'
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
      id, delegation_id, key_id, token_hmac, expires_at
    ) values (
      'a7000000-0000-4000-8000-000000000001',
      'a6000000-0000-4000-8000-000000000002',
      'wdc_test_invalid',
      decode('aa', 'hex'),
      now() + interval '1 hour'
    )$$,
  '23514'::char(5),
  null,
  'delegated credentials require a 256-bit HMAC'
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
