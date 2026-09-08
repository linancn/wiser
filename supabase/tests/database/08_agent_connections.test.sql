begin;

select plan(8);

select has_table('platform_private', 'agent_connections', 'Agent connections remain in the existing private control plane');
select has_table('platform_private', 'agent_exchange_credentials', 'Exchanged credentials retain their OAuth session binding');
select has_function('platform_private', 'agent_access_token_hook', array['jsonb'], 'OAuth token hook binds the approved WISER resource');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'platform_private'
     and c.relname in ('agent_connections', 'agent_exchange_credentials')
     and c.relrowsecurity and c.relforcerowsecurity),
  2::bigint,
  'Both private connection tables enforce RLS'
);

select lives_ok($test$
  do $body$
  declare event jsonb := '{"user_id":"10000000-0000-4000-8000-000000000005","claims":{"sub":"10000000-0000-4000-8000-000000000005","aud":"authenticated","role":"authenticated"}}';
  begin
    if platform_private.agent_access_token_hook(event) <> event then
      raise exception 'Direct human login claims were changed';
    end if;
  end $body$;
$test$, 'The token hook preserves direct human login');

select lives_ok($test$
  do $body$
  declare result jsonb;
  begin
    result := platform_private.agent_access_token_hook('{"user_id":"10000000-0000-4000-8000-000000000005","claims":{"sub":"10000000-0000-4000-8000-000000000005","client_id":"a9000000-0000-4000-8000-000000000001","aud":"authenticated","user_metadata":{"approved":true}}}');
    if result #>> '{error,http_code}' is distinct from '403' then
      raise exception 'Unapproved OAuth client received a usable token';
    end if;
  end $body$;
$test$, 'An unknown OAuth client cannot use user metadata to obtain access');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid
       and p.polname = 'wiser_direct_session_only' and not p.polpermissive)),
  0::bigint,
  'OAuth clients cannot bypass WISER through exposed application tables'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'platform_private' and p.proname = 'agent_access_token_hook'
     and not p.prosecdef and not has_function_privilege('authenticated', p.oid, 'execute')
     and has_function_privilege('supabase_auth_admin', p.oid, 'execute')),
  1::bigint,
  'Only Supabase Auth invokes the token hook without definer privileges'
);

select * from finish();
rollback;
