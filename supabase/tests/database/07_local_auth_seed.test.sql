begin;

select plan(3);

select ok(
  exists (
    select 1
    from auth.users
    where id = '10000000-0000-4000-8000-000000000005'::uuid
      and email = 'operator@agent-excon.test'
      and role = 'authenticated'
      and aud = 'authenticated'
      and email_confirmed_at is not null
      and encrypted_password is not null
  ),
  'the local operator is a confirmed password-auth user'
);

select ok(
  exists (
    select 1
    from auth.identities
    where user_id = '10000000-0000-4000-8000-000000000005'::uuid
      and provider = 'email'
      and identity_data ->> 'email' = 'operator@agent-excon.test'
  ),
  'the local operator has an email identity'
);

select is(
  (
    select raw_app_meta_data ->> 'provider'
    from auth.users
    where id = '10000000-0000-4000-8000-000000000005'::uuid
  ),
  'email',
  'the local operator keeps the email provider claim'
);

select * from finish();
rollback;
