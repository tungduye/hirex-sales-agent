-- Verifies migration 114 (Suối Nguồn filters, tabs and search over all conversations, under RLS).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
select pg_temp.assert_true(public.vi_fold('Nguyễn Văn ĐẠT')='nguyen van dat','marks and case are folded');
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001141','a114@test.local'),('00000000-0000-4000-8000-000000001142','b114@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000114a1','WS 114');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000114b1','00000000-0000-4000-8000-0000000114a1','Role 114');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000001141','00000000-0000-4000-8000-0000000114a1','A','00000000-0000-4000-8000-0000000114b1',true),
  ('00000000-0000-4000-8000-000000001142','00000000-0000-4000-8000-0000000114a1','B','00000000-0000-4000-8000-0000000114b1',true);
insert into public.email_accounts(id,workspace_id,connected_by,provider,email_address,status,scopes) values('00000000-0000-4000-8000-0000000114f1','00000000-0000-4000-8000-0000000114a1','00000000-0000-4000-8000-000000001141','GMAIL','a114@mail.test','CONNECTED',array['https://www.googleapis.com/auth/gmail.send']);
create temp table acc114 as select id from public.channel_accounts where legacy_email_account_id='00000000-0000-4000-8000-0000000114f1';
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('00000000-0000-4000-8000-0000000114b9','00000000-0000-4000-8000-0000000114a1','00000000-0000-4000-8000-000000001141','ZALO','ZALO_BRIDGE','nick-114','Nick','CONNECTED');
insert into acc114 values('00000000-0000-4000-8000-0000000114b9');
grant select on acc114 to authenticated;
insert into public.contacts(id,workspace_id,full_name,phone) values('00000000-0000-4000-8000-0000000114c1','00000000-0000-4000-8000-0000000114a1','Nguyễn Văn An','0901234567');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata,last_message_at,contact_id,assigned_to) values
  ('00000000-0000-4000-8000-0000000114d1','00000000-0000-4000-8000-0000000114a1',(select id from acc114 limit 1),'EMAIL','th1','OPEN','BOT_ALLOWED','{}','2026-10-20T08:00:00Z','00000000-0000-4000-8000-0000000114c1',null),
  ('00000000-0000-4000-8000-0000000114d2','00000000-0000-4000-8000-0000000114a1',(select id from acc114 limit 1),'EMAIL','th2','OPEN','BOT_ALLOWED','{}','2026-10-20T07:00:00Z',null,null),
  ('00000000-0000-4000-8000-0000000114d3','00000000-0000-4000-8000-0000000114a1',(select id from acc114 limit 1),'EMAIL','th3','OPEN','BOT_ALLOWED','{"folder":"OTHER"}','2026-10-20T06:00:00Z',null,null),
  ('00000000-0000-4000-8000-0000000114d4','00000000-0000-4000-8000-0000000114a1','00000000-0000-4000-8000-0000000114b9','ZALO','group-1','OPEN','BOT_ALLOWED','{"conversationKind":"GROUP","groupName":"BrSE Jobs"}','2026-10-20T05:00:00Z',null,null),
  ('00000000-0000-4000-8000-0000000114d5','00000000-0000-4000-8000-0000000114a1','00000000-0000-4000-8000-0000000114b9','ZALO','person-5','OPEN','BOT_ALLOWED','{"participantDisplayName":"Trần Bình"}','2026-10-20T04:00:00Z',null,'00000000-0000-4000-8000-000000001141'),
  ('00000000-0000-4000-8000-0000000114d6','00000000-0000-4000-8000-0000000114a1','00000000-0000-4000-8000-0000000114b9','ZALO','group-6','OPEN','BOT_ALLOWED','{}','2026-10-20T03:00:00Z',null,null);
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at)
select '00000000-0000-4000-8000-0000000114a1', c.id, c.channel_account_id, c.channel_type, 'm-'||c.provider_conversation_id||'-'||v.n, v.direction, v.sender, v.body, v.at, v.at, v.at
from public.omnichannel_conversations c join (values
  ('th1',1,'INBOUND','an@khach.vn','Cho em hỏi job BrSE','2026-09-01T08:00:00Z'::timestamptz),
  ('th1',2,'INBOUND','an@khach.vn','Anh trả lời giúp em','2026-10-20T08:00:00Z'::timestamptz),
  ('th2',1,'INBOUND','no-reply@accounts.google.com','Cảnh báo bảo mật','2026-10-20T07:00:00Z'::timestamptz),
  ('th3',1,'INBOUND','hr@cty.vn','Thư khác','2026-10-20T06:00:00Z'::timestamptz),
  ('group-1',1,'INBOUND','member-9','Chào cả nhóm','2026-10-20T05:00:00Z'::timestamptz),
  ('person-5',1,'INBOUND','person-5','Em chào anh','2026-10-19T04:00:00Z'::timestamptz),
  ('person-5',2,'OUTBOUND','nick-114','Chào em','2026-10-20T04:00:00Z'::timestamptz),
  ('group-6',1,'INBOUND','member-2','Tin trong nhóm không có tên','2026-10-20T03:00:00Z'::timestamptz)
) as v(conv,n,direction,sender,body,at) on v.conv=c.provider_conversation_id
where c.workspace_id='00000000-0000-4000-8000-0000000114a1';
-- Tag triggers check the acting member; fixtures are inserted as the database owner.
set local session_replication_role = replica;
insert into public.conversation_tags(id,workspace_id,name) values('00000000-0000-4000-8000-0000000114e1','00000000-0000-4000-8000-0000000114a1','BrSE'),('00000000-0000-4000-8000-0000000114e2','00000000-0000-4000-8000-0000000114a1','HCM');
insert into public.conversation_tag_links(workspace_id,conversation_id,tag_id) values
  ('00000000-0000-4000-8000-0000000114a1','00000000-0000-4000-8000-0000000114d1','00000000-0000-4000-8000-0000000114e1'),
  ('00000000-0000-4000-8000-0000000114a1','00000000-0000-4000-8000-0000000114d5','00000000-0000-4000-8000-0000000114e1'),
  ('00000000-0000-4000-8000-0000000114a1','00000000-0000-4000-8000-0000000114d5','00000000-0000-4000-8000-0000000114e2');
set local session_replication_role = origin;
-- Supabase grants these to authenticated by default (row level security decides the rows); the local harness does not.
grant select on public.contacts, public.omnichannel_conversations, public.omnichannel_messages, public.conversation_tag_links to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001141',true);
create temp table ids114 as select array_agg(id) a from acc114;
create function pg_temp.list(p_view text, p_search text default null, p_tags uuid[] default null, p_mode text default 'all', p_from date default null, p_to date default null)
returns text language sql as $$ select coalesce(string_agg(right(l.id::text, 2), ',' order by o), '') from public.inbox_list_conversations((select a from ids114), null, p_tags, p_mode, p_from, p_to, p_view, p_search, '00000000-0000-4000-8000-000000001141', 51, null, null) with ordinality as l(id, sort_at, matched, o) $$;
grant execute on function pg_temp.list(text,text,uuid[],text,date,date) to authenticated;
select pg_temp.assert_true(pg_temp.list('all')='d1,d5','Tất cả: people only, newest first');
select pg_temp.assert_true(pg_temp.list('waiting')='d1','Chưa trả lời: latest message is from the customer');
select pg_temp.assert_true(pg_temp.list('mine')='d5','Giao cho tôi');
select pg_temp.assert_true(pg_temp.list('groups')='d4,d6','Nhóm: flagged by sync, or someone else wrote in the chat');
select pg_temp.assert_true(pg_temp.list('other')='d2,d3','Khác: robots and the OTHER folder');
select pg_temp.assert_true(pg_temp.list('all','nguyen van')='d1','search without marks finds the contact');
select pg_temp.assert_true(pg_temp.list('any','0901234')='d1','search by phone');
select pg_temp.assert_true(pg_temp.list('groups','brse')='d4','search by group name');
select pg_temp.assert_true(pg_temp.list('any',null,array['00000000-0000-4000-8000-0000000114e1','00000000-0000-4000-8000-0000000114e2']::uuid[],'all')='d5','tags: all of them');
select pg_temp.assert_true(pg_temp.list('any',null,array['00000000-0000-4000-8000-0000000114e1','00000000-0000-4000-8000-0000000114e2']::uuid[],'any')='d1,d5','tags: any of them');
select pg_temp.assert_true((select string_agg(right(l.id::text,2), ',') from public.inbox_list_conversations((select a from ids114), null, null, 'all', null, null, 'any', null, null, 2,
  '2026-10-20T06:00:00Z', '00000000-0000-4000-8000-0000000114d3') l)='d4,d5','next page after a cursor');
select pg_temp.assert_true(pg_temp.list('any',null,null,'all','2026-10-01','2026-10-31')='d2,d3,d4,d5,d6','first message in October (d1 started in September)');
select pg_temp.assert_true((select string_agg(view||'='||total||case when capped then '+' else '' end, ',' order by view) from public.inbox_view_counts((select a from ids114), null, null, 'all', null, null, null, '00000000-0000-4000-8000-000000001141'))='all=2,groups=2,mine=1,other=2,waiting=1','tab counts');
reset role;
rollback;
