-- 104: Saved conversations of Trợ lý HireX (like a chat app): each member keeps their own list of
-- conversations; the server writes the messages after each answer. Members read, rename, pin and delete
-- only their own. Proposal cards keep their id so their current state is read from assistant_actions.
begin;

create table public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  title text not null default 'Cuộc trò chuyện mới',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_conversations_user_fk foreign key (user_id, workspace_id) references public.profiles(id, workspace_id) on delete cascade,
  constraint assistant_conversations_title check (char_length(btrim(title)) between 1 and 120)
);
create index assistant_conversations_user_recent on public.assistant_conversations(workspace_id, user_id, updated_at desc);

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 20000),
  tools_used text[] not null default '{}',
  action_ids uuid[] not null default '{}',
  is_error boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create index assistant_messages_conversation on public.assistant_messages(conversation_id, created_at);

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
create policy assistant_conversations_own_select on public.assistant_conversations for select to authenticated
  using (workspace_id = public.current_workspace_id() and user_id = auth.uid());
create policy assistant_conversations_own_update on public.assistant_conversations for update to authenticated
  using (workspace_id = public.current_workspace_id() and user_id = auth.uid())
  with check (workspace_id = public.current_workspace_id() and user_id = auth.uid());
create policy assistant_conversations_own_delete on public.assistant_conversations for delete to authenticated
  using (workspace_id = public.current_workspace_id() and user_id = auth.uid());
create policy assistant_messages_own_select on public.assistant_messages for select to authenticated
  using (workspace_id = public.current_workspace_id() and user_id = auth.uid());

revoke all on public.assistant_conversations from anon, authenticated;
revoke all on public.assistant_messages from anon, authenticated;
grant select, delete on public.assistant_conversations to authenticated;
grant update (title, pinned) on public.assistant_conversations to authenticated;
grant select on public.assistant_messages to authenticated;
grant all on public.assistant_conversations to service_role;
grant all on public.assistant_messages to service_role;

commit;
