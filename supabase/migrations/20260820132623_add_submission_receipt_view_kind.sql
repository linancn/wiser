alter table public.agent_view_receipts
  drop constraint agent_view_receipts_view_kind_check,
  add constraint agent_view_receipts_view_kind_check check (view_kind in (
    'inject', 'task', 'message', 'artifact', 'feedback', 'submission',
    'role_assignment', 'system'
  ));
