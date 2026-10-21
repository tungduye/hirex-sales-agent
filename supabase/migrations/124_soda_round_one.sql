-- 124: Soda, đợt 1.
-- 1) Khách hàng: the day HireX first saw a company in each block ("Hot Do mới tuần này", "Hot Do lên trong tháng 10").
--    From now on the sync records it; companies already there get the day they were created in Human (best guess).
-- 2) Suối Nguồn: conversations with Japanese people (kana in their messages, a .jp address, Japan as country or
--    Japanese as language), with what decides their tab. Security invoker: row level security still applies.
begin;

alter table public.human_partners add column block_seen jsonb not null default '{}'::jsonb;
alter table public.human_partners add constraint human_partners_block_seen_object check (jsonb_typeof(block_seen) = 'object');
update public.human_partners p set block_seen = coalesce((
  select jsonb_object_agg(b::text, to_char(coalesce(p.human_created_at, p.synced_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  from unnest(p.block_ids) b), '{}'::jsonb);

create or replace function public.human_partners_track_blocks()
returns trigger language plpgsql set search_path = '' as $$
declare v_block integer;
begin
  new.block_seen := coalesce(case when tg_op = 'UPDATE' then old.block_seen end, new.block_seen, '{}'::jsonb);
  foreach v_block in array coalesce(new.block_ids, '{}'::integer[]) loop
    if not new.block_seen ? v_block::text then
      new.block_seen := new.block_seen || jsonb_build_object(v_block::text, to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
    end if;
  end loop;
  return new;
end $$;
create trigger human_partners_track_blocks before insert or update of block_ids on public.human_partners
for each row execute function public.human_partners_track_blocks();

create or replace function public.inbox_japanese_conversations(p_account_ids uuid[], p_channel_types text[], p_since timestamptz)
returns table(id uuid, channel_account_id uuid, channel_type text, sort_at timestamptz, is_group boolean, is_other boolean, latest_direction text, name text, reason text)
language sql stable security invoker set search_path = public as $$
  select f.id, c.channel_account_id, c.channel_type, f.sort_at, f.is_group, f.is_other, f.latest_direction,
    coalesce(nullif(c.subject, ''), c.metadata->>'participantDisplayName', c.metadata->>'conversationDisplayName', c.metadata->>'groupName', ct.full_name, ct.email),
    case
      when coalesce(ct.language, '') ilike 'ja%' or lower(coalesce(ct.country, '')) in ('japan', 'jp', 'nhật', 'nhật bản', '日本') then 'Liên hệ ghi Nhật Bản/tiếng Nhật'
      when coalesce(ct.email, '') ~* '\.jp$' or exists (select 1 from public.omnichannel_messages m where m.workspace_id = c.workspace_id and m.conversation_id = c.id
        and m.direction = 'INBOUND' and c.channel_type = 'EMAIL' and m.sender_external_id ~* '\.jp>?$') then 'Email đuôi .jp'
      else 'Nhắn bằng tiếng Nhật' end
  from public.inbox_filtered_conversations(p_account_ids, p_channel_types, null, 'all', null, null, null, null, p_since, null, null, 5001) f
  join public.omnichannel_conversations c on c.id = f.id
  left join public.contacts ct on ct.id = c.contact_id
  where coalesce(ct.language, '') ilike 'ja%' or lower(coalesce(ct.country, '')) in ('japan', 'jp', 'nhật', 'nhật bản', '日本')
    or coalesce(ct.email, '') ~* '\.jp$'
    or exists (select 1 from public.omnichannel_messages m where m.workspace_id = c.workspace_id and m.conversation_id = c.id and m.direction = 'INBOUND'
      and (m.text_content ~ '[ぁ-ゖァ-ヺー]{2,}' or (c.channel_type = 'EMAIL' and m.sender_external_id ~* '\.jp>?$')));
$$;
revoke all on function public.inbox_japanese_conversations(uuid[], text[], timestamptz) from public, anon;
grant execute on function public.inbox_japanese_conversations(uuid[], text[], timestamptz) to authenticated;

-- Suối Nguồn counts for Soda ("bao nhiêu email khách phản hồi chưa được tiếp"): the same tab rules as the list,
-- with each conversation's nick and channel, so counts can be split per nick.
create or replace function public.inbox_conversation_tabs(p_account_ids uuid[], p_channel_types text[], p_since timestamptz)
returns table(id uuid, channel_account_id uuid, channel_type text, sort_at timestamptz, is_group boolean, is_other boolean, latest_direction text, unread_count integer, assigned_to uuid)
language sql stable security invoker set search_path = public as $$
  select f.id, c.channel_account_id, c.channel_type, f.sort_at, f.is_group, f.is_other, f.latest_direction, c.unread_count, f.assigned_to
  from public.inbox_filtered_conversations(p_account_ids, p_channel_types, null, 'all', null, null, null, null, p_since, null, null, 20001) f
  join public.omnichannel_conversations c on c.id = f.id;
$$;
revoke all on function public.inbox_conversation_tabs(uuid[], text[], timestamptz) from public, anon;
grant execute on function public.inbox_conversation_tabs(uuid[], text[], timestamptz) to authenticated;

commit;
