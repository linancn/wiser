alter table public.run_messages
  add column kind text not null default 'inform',
  add column thread_id uuid,
  add column reply_to_message_id uuid,
  add column artifact_version_refs jsonb not null default '[]'::jsonb;

update public.run_messages
set thread_id = id
where thread_id is null;

alter table public.run_messages
  alter column thread_id set not null,
  add constraint run_messages_kind_check
    check (kind in ('inform', 'request', 'response', 'handoff')),
  add constraint run_messages_reply_shape_check
    check ((kind = 'response') = (reply_to_message_id is not null)),
  add constraint run_messages_handoff_refs_check
    check (
      jsonb_typeof(artifact_version_refs) = 'array'
      and (kind <> 'handoff' or jsonb_array_length(artifact_version_refs) > 0)
    ),
  add constraint run_messages_thread_fk
    foreign key (thread_id, run_id)
    references public.run_messages(id, run_id) on delete restrict,
  add constraint run_messages_reply_fk
    foreign key (reply_to_message_id, run_id)
    references public.run_messages(id, run_id) on delete restrict;

create index run_messages_thread_idx
  on public.run_messages (thread_id, run_id, sent_at);
create index run_messages_reply_idx
  on public.run_messages (reply_to_message_id, run_id)
  where reply_to_message_id is not null;

create or replace function excon_private.guard_run_message_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_kind text;
  parent_thread_id uuid;
begin
  if new.kind <> 'response' then
    if new.reply_to_message_id is not null or new.thread_id <> new.id then
      raise exception using
        errcode = '23514',
        message = 'root messages must own their thread and cannot reference a parent';
    end if;
    return new;
  end if;

  select parent.kind, parent.thread_id
  into parent_kind, parent_thread_id
  from public.run_messages as parent
  where parent.id = new.reply_to_message_id
    and parent.run_id = new.run_id;

  if parent_kind is distinct from 'request'
    or parent_thread_id is distinct from new.thread_id then
    raise exception using
      errcode = '23514',
      message = 'response messages must inherit an existing request thread';
  end if;

  if not exists (
    select 1
    from public.agent_view_receipts as receipt
    where receipt.run_id = new.run_id
      and receipt.run_agent_id = new.sender_run_agent_id
      and receipt.resource_type = 'message'
      and receipt.resource_id = new.reply_to_message_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'the responding run agent has not received the parent request';
  end if;

  return new;
end;
$$;

create trigger run_messages_thread_guard
before insert on public.run_messages
for each row execute function excon_private.guard_run_message_thread();
