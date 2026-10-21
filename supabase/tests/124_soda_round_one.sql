-- Verifies migration 124 (Soda đợt 1): first day in a block; Suối Nguồn counts and Japanese conversations under RLS.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001241','a124@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000124a1','WS 124');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000124b1','00000000-0000-4000-8000-0000000124a1','Role 124');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values('00000000-0000-4000-8000-000000001241','00000000-0000-4000-8000-0000000124a1','A','00000000-0000-4000-8000-0000000124b1',true);

-- Khối: a new company gets today for its blocks; a later block gets its own day; an old day is kept.
insert into public.human_partners(workspace_id,partner_id,name,block_ids) values('00000000-0000-4000-8000-0000000124a1',1,'Công ty A',array[36309]);
select pg_temp.assert_true((select block_seen ? '36309' from public.human_partners where partner_id=1 and workspace_id='00000000-0000-4000-8000-0000000124a1'),'new company: day in its block recorded');
update public.human_partners set block_seen='{"36309":"2026-01-01T00:00:00Z"}' where partner_id=1 and workspace_id='00000000-0000-4000-8000-0000000124a1';
update public.human_partners set block_ids=array[36309,36310], name='Công ty A2' where partner_id=1 and workspace_id='00000000-0000-4000-8000-0000000124a1';
select pg_temp.assert_true((select block_seen->>'36309'='2026-01-01T00:00:00Z' and block_seen ? '36310' from public.human_partners where partner_id=1 and workspace_id='00000000-0000-4000-8000-0000000124a1'),'later block gets its own day, earlier day kept');
insert into public.human_partners(workspace_id,partner_id,name,block_ids) values('00000000-0000-4000-8000-0000000124a1',1,'Upsert',array[36309,36310])
  on conflict (workspace_id,partner_id) do update set name=excluded.name, block_ids=excluded.block_ids;
select pg_temp.assert_true((select block_seen->>'36309'='2026-01-01T00:00:00Z' from public.human_partners where partner_id=1 and workspace_id='00000000-0000-4000-8000-0000000124a1'),'the sync upsert keeps the days');

-- Suối Nguồn.
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('00000000-0000-4000-8000-0000000124b9','00000000-0000-4000-8000-0000000124a1','00000000-0000-4000-8000-000000001241','ZALO','ZALO_BRIDGE','nick-124','Nick','CONNECTED');
insert into public.contacts(id,workspace_id,full_name,country) values('00000000-0000-4000-8000-0000000124c1','00000000-0000-4000-8000-0000000124a1','Tanaka','Japan');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata,last_message_at,contact_id) values
  ('00000000-0000-4000-8000-0000000124d1','00000000-0000-4000-8000-0000000124a1','00000000-0000-4000-8000-0000000124b9','ZALO','p-1','OPEN','BOT_ALLOWED','{}',now() - interval '1 day',null),
  ('00000000-0000-4000-8000-0000000124d2','00000000-0000-4000-8000-0000000124a1','00000000-0000-4000-8000-0000000124b9','ZALO','p-2','OPEN','BOT_ALLOWED','{}',now() - interval '2 days','00000000-0000-4000-8000-0000000124c1'),
  ('00000000-0000-4000-8000-0000000124d3','00000000-0000-4000-8000-0000000124a1','00000000-0000-4000-8000-0000000124b9','ZALO','p-3','OPEN','BOT_ALLOWED','{}',now() - interval '3 days',null),
  ('00000000-0000-4000-8000-0000000124d4','00000000-0000-4000-8000-0000000124a1','00000000-0000-4000-8000-0000000124b9','ZALO','g-4','OPEN','BOT_ALLOWED','{"isGroup":true}',now() - interval '1 day',null);
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at)
select '00000000-0000-4000-8000-0000000124a1', c.id, c.channel_account_id, 'ZALO', 'm-'||v.n, v.direction, v.sender, v.body, v.at, v.at, v.at
from public.omnichannel_conversations c join (values
  ('p-1',1,'INBOUND','p-1','よろしくお願いします', now() - interval '1 day'),
  ('p-2',2,'INBOUND','p-2','Hello', now() - interval '3 days'),
  ('p-2',3,'OUTBOUND','nick-124','Chào anh', now() - interval '2 days'),
  ('p-3',4,'INBOUND','p-3','Em chào anh', now() - interval '3 days'),
  ('g-4',5,'INBOUND','m-9','こんにちは', now() - interval '1 day')
) as v(conv,n,direction,sender,body,at) on v.conv=c.provider_conversation_id
where c.workspace_id='00000000-0000-4000-8000-0000000124a1';
grant select on public.contacts, public.omnichannel_conversations, public.omnichannel_messages, public.conversation_tag_links to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001241',true);
create temp table tabs124 as select * from public.inbox_conversation_tabs(array['00000000-0000-4000-8000-0000000124b9']::uuid[], null, now() - interval '30 days');
select pg_temp.assert_true((select count(*)=4 from tabs124),'every conversation of the nick, with its tab facts');
select pg_temp.assert_true((select string_agg(right(id::text,2),',' order by id) from tabs124 where not is_group and not is_other and latest_direction='INBOUND')='d1,d3','waiting: the customer wrote last');
select pg_temp.assert_true((select bool_and(channel_account_id='00000000-0000-4000-8000-0000000124b9') from tabs124),'nick returned for per-nick counts');
create temp table jp124 as select * from public.inbox_japanese_conversations(array['00000000-0000-4000-8000-0000000124b9']::uuid[], null, now() - interval '30 days');
select pg_temp.assert_true((select string_agg(right(id::text,2),',' order by id) from jp124)='d1,d2,d4','Japanese: kana in messages or contact in Japan');
select pg_temp.assert_true((select reason from jp124 where right(id::text,2)='d2')='Liên hệ ghi Nhật Bản/tiếng Nhật' and (select reason from jp124 where right(id::text,2)='d1')='Nhắn bằng tiếng Nhật','reason given');
select pg_temp.assert_true((select count(*)=0 from public.inbox_japanese_conversations(array['00000000-0000-4000-8000-0000000124b9']::uuid[], null, now() - interval '12 hours')),'date window');
reset role;
rollback;
