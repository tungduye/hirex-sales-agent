-- Inbox hot-path indexes and one-row-per-conversation preview lookup.
create index if not exists omnichannel_messages_conversation_created_idx
  on public.omnichannel_messages(workspace_id, conversation_id, created_at desc, id desc);

create index if not exists omnichannel_conversations_workspace_recent_idx
  on public.omnichannel_conversations(workspace_id, last_message_at desc, id desc);

create index if not exists outbound_actions_conversation_status_recent_idx
  on public.channel_outbound_actions(workspace_id, conversation_id, status, created_at desc);

create index if not exists conversation_tag_links_conversation_idx
  on public.conversation_tag_links(workspace_id, conversation_id, tag_id);

create or replace function public.get_inbox_conversation_previews(p_conversation_ids uuid[])
returns table(
  conversation_id uuid,
  direction text,
  sender_external_id text,
  text_content text,
  received_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz,
  last_inbound_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id,
         latest.direction,
         latest.sender_external_id,
         latest.text_content,
         latest.received_at,
         latest.sent_at,
         latest.created_at,
         inbound.last_inbound_at
  from public.omnichannel_conversations c
  left join lateral (
    select m.direction, m.sender_external_id, m.text_content,
           m.received_at, m.sent_at, m.created_at
    from public.omnichannel_messages m
    where m.workspace_id = c.workspace_id and m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true
  left join lateral (
    select coalesce(m.received_at, m.created_at) as last_inbound_at
    from public.omnichannel_messages m
    where m.workspace_id = c.workspace_id and m.conversation_id = c.id and m.direction = 'INBOUND'
    order by m.created_at desc, m.id desc
    limit 1
  ) inbound on true
  where c.id = any(p_conversation_ids)
    and c.workspace_id = public.current_workspace_id();
$$;

revoke all on function public.get_inbox_conversation_previews(uuid[]) from public;
grant execute on function public.get_inbox_conversation_previews(uuid[]) to authenticated;

