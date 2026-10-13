-- Enforce per-profile connected-account scope at the database boundary.
begin;

-- The pre-existing self-profile UPDATE policy must not permit privilege escalation.
create function public.prevent_profile_access_escalation() returns trigger
language plpgsql set search_path='' as $$
begin
  if (select auth.role())='authenticated' and
    (new.role_id is distinct from old.role_id or new.all_channel_accounts is distinct from old.all_channel_accounts
      or new.workspace_id is distinct from old.workspace_id) then
    raise exception 'Profile access fields are managed by workspace administrators';
  end if;
  return new;
end $$;
create trigger profiles_prevent_access_escalation before update on public.profiles
for each row execute function public.prevent_profile_access_escalation();

create function public.rbac_account_scope_hardened() returns boolean
language sql stable security definer set search_path='' as $$ select true $$;
revoke all on function public.rbac_account_scope_hardened() from public;
grant execute on function public.rbac_account_scope_hardened() to authenticated;

-- Remove legacy workspace-wide policies. PostgreSQL combines permissive policies with OR.
drop policy if exists channel_accounts_read on public.channel_accounts;
drop policy if exists channel_accounts_select_workspace on public.channel_accounts;
drop policy if exists channel_accounts_select_scoped on public.channel_accounts;
create policy channel_accounts_select_scoped on public.channel_accounts for select to authenticated
using(workspace_id=public.current_workspace_id() and public.can_access_channel_account(id));

drop policy if exists omnichannel_conversations_read on public.omnichannel_conversations;
create policy omnichannel_conversations_read_scoped on public.omnichannel_conversations for select to authenticated
using(workspace_id=public.current_workspace_id() and public.can_access_channel_account(channel_account_id));

drop policy if exists omnichannel_messages_read on public.omnichannel_messages;
create policy omnichannel_messages_read_scoped on public.omnichannel_messages for select to authenticated
using(workspace_id=public.current_workspace_id() and public.can_access_channel_account(channel_account_id));

drop policy if exists channel_outbound_actions_read on public.channel_outbound_actions;
create policy channel_outbound_actions_read_scoped on public.channel_outbound_actions for select to authenticated
using(workspace_id=public.current_workspace_id() and public.can_access_channel_account(channel_account_id));

drop policy if exists conversation_tag_links_read on public.conversation_tag_links;
create policy conversation_tag_links_read_scoped on public.conversation_tag_links for select to authenticated
using(workspace_id=public.current_workspace_id() and exists(
  select 1 from public.omnichannel_conversations c where c.id=conversation_id and c.workspace_id=conversation_tag_links.workspace_id
    and public.can_access_channel_account(c.channel_account_id)
));

drop policy if exists channel_message_attachments_read on public.channel_message_attachments;
create policy channel_message_attachments_read_scoped on public.channel_message_attachments for select to authenticated
using(workspace_id=public.current_workspace_id() and exists(
  select 1 from public.omnichannel_messages m where m.id=message_id and m.workspace_id=channel_message_attachments.workspace_id
    and public.can_access_channel_account(m.channel_account_id)
));

drop policy if exists channel_attachments_read on public.channel_attachments;
create policy channel_attachments_read_scoped on public.channel_attachments for select to authenticated
using(workspace_id=public.current_workspace_id() and exists(
  select 1 from public.channel_message_attachments l join public.omnichannel_messages m
    on m.id=l.message_id and m.workspace_id=l.workspace_id
  where l.attachment_id=channel_attachments.id and l.workspace_id=channel_attachments.workspace_id
    and public.can_access_channel_account(m.channel_account_id)
));

drop policy if exists email_accounts_select_workspace on public.email_accounts;
create policy email_accounts_select_scoped on public.email_accounts for select to authenticated
using(workspace_id=public.current_workspace_id() and exists(
  select 1 from public.channel_accounts a where a.workspace_id=email_accounts.workspace_id
    and a.legacy_email_account_id=email_accounts.id and public.can_access_channel_account(a.id)
));

drop policy if exists email_threads_select_workspace on public.email_threads;
create policy email_threads_select_scoped on public.email_threads for select to authenticated
using(workspace_id=public.current_workspace_id() and exists(
  select 1 from public.channel_accounts a where a.workspace_id=email_threads.workspace_id
    and a.legacy_email_account_id=email_threads.email_account_id and public.can_access_channel_account(a.id)
));

drop policy if exists email_messages_select_workspace on public.email_messages;
create policy email_messages_select_scoped on public.email_messages for select to authenticated
using(workspace_id=public.current_workspace_id() and exists(
  select 1 from public.channel_accounts a where a.workspace_id=email_messages.workspace_id
    and a.legacy_email_account_id=email_messages.email_account_id and public.can_access_channel_account(a.id)
));

commit;
