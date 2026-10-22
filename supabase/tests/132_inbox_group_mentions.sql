-- Verifies migration 132 (Chưa trả lời: Zalo groups where my nick was tagged and has not answered).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
select pg_temp.assert_true(public.vi_fold('Nguyễn Văn ĐẠT')='nguyen van dat','marks and case are folded');
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000013001','a130@test.local'),('00000000-0000-4000-8000-000000013002','b130@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000001300a1','WS 130');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000001300b1','00000000-0000-4000-8000-0000001300a1','Role 130');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000013001','00000000-0000-4000-8000-0000001300a1','A','00000000-0000-4000-8000-0000001300b1',true),
  ('00000000-0000-4000-8000-000000013002','00000000-0000-4000-8000-0000001300a1','B','00000000-0000-4000-8000-0000001300b1',true);
insert into public.email_accounts(id,workspace_id,connected_by,provider,email_address,status,scopes) values('00000000-0000-4000-8000-0000001300f1','00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-000000013001','GMAIL','a130@mail.test','CONNECTED',array['https://www.googleapis.com/auth/gmail.send']);
create temp table acc130 as select id from public.channel_accounts where legacy_email_account_id='00000000-0000-4000-8000-0000001300f1';
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('00000000-0000-4000-8000-0000001300b9','00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-000000013001','ZALO','ZALO_BRIDGE','nick-130','Nick','CONNECTED');
insert into acc130 values('00000000-0000-4000-8000-0000001300b9');
grant select on acc130 to authenticated;
insert into public.contacts(id,workspace_id,full_name,phone) values('00000000-0000-4000-8000-0000001300c1','00000000-0000-4000-8000-0000001300a1','Nguyễn Văn An','0901234567');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata,last_message_at,contact_id,assigned_to) values
  ('00000000-0000-4000-8000-0000001300d1','00000000-0000-4000-8000-0000001300a1',(select id from acc130 limit 1),'EMAIL','th1','OPEN','BOT_ALLOWED','{}','2026-10-20T08:00:00Z','00000000-0000-4000-8000-0000001300c1',null),
  ('00000000-0000-4000-8000-0000001300d2','00000000-0000-4000-8000-0000001300a1',(select id from acc130 limit 1),'EMAIL','th2','OPEN','BOT_ALLOWED','{}','2026-10-20T07:00:00Z',null,null),
  ('00000000-0000-4000-8000-0000001300d3','00000000-0000-4000-8000-0000001300a1',(select id from acc130 limit 1),'EMAIL','th3','OPEN','BOT_ALLOWED','{"folder":"OTHER"}','2026-10-20T06:00:00Z',null,null),
  ('00000000-0000-4000-8000-0000001300d4','00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300b9','ZALO','group-1','OPEN','BOT_ALLOWED','{"conversationKind":"GROUP","groupName":"BrSE Jobs"}','2026-10-20T05:00:00Z',null,null),
  ('00000000-0000-4000-8000-0000001300d5','00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300b9','ZALO','person-5','OPEN','BOT_ALLOWED','{"participantDisplayName":"Trần Bình"}','2026-10-20T04:00:00Z',null,'00000000-0000-4000-8000-000000013001'),
  ('00000000-0000-4000-8000-0000001300d6','00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300b9','ZALO','group-6','OPEN','BOT_ALLOWED','{}','2026-10-20T03:00:00Z',null,null);
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at)
select '00000000-0000-4000-8000-0000001300a1', c.id, c.channel_account_id, c.channel_type, 'm-'||c.provider_conversation_id||'-'||v.n, v.direction, v.sender, v.body, v.at, v.at, v.at
from public.omnichannel_conversations c join (values
  ('th1',1,'INBOUND','an@khach.vn','Cho em hỏi job BrSE','2026-09-01T08:00:00Z'::timestamptz),
  ('th1',2,'INBOUND','an@khach.vn','Anh trả lời giúp em','2026-10-20T08:00:00Z'::timestamptz),
  ('th2',1,'INBOUND','no-reply@accounts.google.com','Cảnh báo bảo mật','2026-10-20T07:00:00Z'::timestamptz),
  ('th3',1,'INBOUND','hr@cty.vn','Thư khác','2026-10-20T06:00:00Z'::timestamptz),
  ('group-1',1,'INBOUND','member-9','Chào cả nhóm','2026-10-20T05:00:00Z'::timestamptz),
  ('person-5',1,'INBOUND','person-5','Em chào anh','2026-10-19T04:00:00Z'::timestamptz),
  ('person-5',2,'OUTBOUND','nick-130','Chào em','2026-10-20T04:00:00Z'::timestamptz),
  ('group-6',1,'INBOUND','member-2','Tin trong nhóm không có tên','2026-10-20T03:00:00Z'::timestamptz)
) as v(conv,n,direction,sender,body,at) on v.conv=c.provider_conversation_id
where c.workspace_id='00000000-0000-4000-8000-0000001300a1';
-- Tag triggers check the acting member; fixtures are inserted as the database owner.
set local session_replication_role = replica;
insert into public.conversation_tags(id,workspace_id,name) values('00000000-0000-4000-8000-0000001300e1','00000000-0000-4000-8000-0000001300a1','BrSE'),('00000000-0000-4000-8000-0000001300e2','00000000-0000-4000-8000-0000001300a1','HCM');
insert into public.conversation_tag_links(workspace_id,conversation_id,tag_id) values
  ('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d1','00000000-0000-4000-8000-0000001300e1'),
  ('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d5','00000000-0000-4000-8000-0000001300e1'),
  ('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d5','00000000-0000-4000-8000-0000001300e2');
set local session_replication_role = origin;
-- Supabase grants these to authenticated by default (row level security decides the rows); the local harness does not.
grant select on public.contacts, public.omnichannel_conversations, public.omnichannel_messages, public.conversation_tag_links to authenticated;
-- More fixtures: the Zalo nick's main user is A; d7 unassigned on it, d8 assigned to B; d3 (old Khác folder) is important.
update public.channel_accounts set primary_profile_id='00000000-0000-4000-8000-000000013001' where id='00000000-0000-4000-8000-0000001300b9';
update public.omnichannel_conversations set metadata='{"participantDisplayName":"Google Security"}' where id='00000000-0000-4000-8000-0000001300d2';
update public.omnichannel_conversations set metadata='{"folder":"OTHER","important":true}' where id='00000000-0000-4000-8000-0000001300d3';
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata,last_message_at,assigned_to) values
  ('00000000-0000-4000-8000-0000001300d7','00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300b9','ZALO','person-7','OPEN','BOT_ALLOWED','{}','2026-10-20T02:00:00Z',null),
  ('00000000-0000-4000-8000-0000001300d8','00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300b9','ZALO','person-8','OPEN','BOT_ALLOWED','{}','2026-10-20T01:00:00Z','00000000-0000-4000-8000-000000013002');
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at) values
  ('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d7','00000000-0000-4000-8000-0000001300b9','ZALO','m-p7','INBOUND','person-7','Chào','2026-10-20T02:00:00Z','2026-10-20T02:00:00Z','2026-10-20T02:00:00Z'),
  ('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d8','00000000-0000-4000-8000-0000001300b9','ZALO','m-p8','INBOUND','person-8','Chào','2026-10-20T01:00:00Z','2026-10-20T01:00:00Z','2026-10-20T01:00:00Z');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300b1','inbox.view'),('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300b1','inbox.update');
insert into public.ai_recruiter_bots(id,workspace_id,name,enabled,created_by,bot_type) values('00000000-0000-4000-8000-0000001300f7','00000000-0000-4000-8000-0000001300a1','AI Rec v2',true,'00000000-0000-4000-8000-000000013001','RECRUITER'),('00000000-0000-4000-8000-0000001300f8','00000000-0000-4000-8000-0000001300a1','AI tắt',false,'00000000-0000-4000-8000-000000013001','SALE');
grant select on public.contacts, public.omnichannel_conversations, public.omnichannel_messages, public.conversation_tag_links to authenticated;
-- Times relative to now: tags older than 14 days are ignored on purpose.
create temp table base132 as select date_trunc('day', now()) - interval '1 day' as b;
grant select on base132 to authenticated;
update public.channel_accounts set display_name='Ngân Lê', external_account_id='5550001' where id='00000000-0000-4000-8000-0000001300b9';
select pg_temp.assert_true(public.zalo_text_mentions('@ngan le xem giúp', array['Ngân Lê']),'marks and case ignored');
select pg_temp.assert_true(not public.zalo_text_mentions('@Allen ơi', array['All']),'@All is not @Allen');
select pg_temp.assert_true(public.zalo_text_mentions('Nhờ @All nhé', array['All']),'@All');
select pg_temp.assert_true(not public.zalo_text_mentions('@Ngân', array['Ngân Lê']),'part of the name is not a tag');
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at) values('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d4','00000000-0000-4000-8000-0000001300b9','ZALO','m-g-a','INBOUND','member-9','Chào cả nhóm',(select b from base132) + interval '6 hours 0 minutes',(select b from base132) + interval '6 hours 0 minutes',(select b from base132) + interval '6 hours 0 minutes');
select pg_temp.assert_true((select mention_pending_at is null from public.omnichannel_conversations where id='00000000-0000-4000-8000-0000001300d4'),'no tag, nothing pending');
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at) values('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d4','00000000-0000-4000-8000-0000001300b9','ZALO','m-g-b','INBOUND','member-9','@Ngân Lê check job này giúp chị',(select b from base132) + interval '7 hours 0 minutes',(select b from base132) + interval '7 hours 0 minutes',(select b from base132) + interval '7 hours 0 minutes');
select pg_temp.assert_true((select mention_pending_at=(select b from base132) + interval '7 hours 0 minutes' from public.omnichannel_conversations where id='00000000-0000-4000-8000-0000001300d4'),'tag recorded');
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at) values('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d7','00000000-0000-4000-8000-0000001300b9','ZALO','m-o-b','INBOUND','person-7','@Ngân Lê ơi',(select b from base132) + interval '7 hours 5 minutes',(select b from base132) + interval '7 hours 5 minutes',(select b from base132) + interval '7 hours 5 minutes');
select pg_temp.assert_true((select mention_pending_at is null from public.omnichannel_conversations where id='00000000-0000-4000-8000-0000001300d7'),'one-to-one chats are not group tags');
grant select on public.contacts, public.omnichannel_conversations, public.omnichannel_messages, public.conversation_tag_links to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000013001',true);
create temp table ids132 as select array_agg(id) a from acc130;
select pg_temp.assert_true((select bool_or(right(l.id::text,2)='d4') from public.inbox_list_conversations((select a from ids132), null, null, 'all', null, null, 'waiting', null, '00000000-0000-4000-8000-000000013001', 51, null, null) l),'tagged group shows in Chưa trả lời');
select pg_temp.assert_true((select total>=1 from public.inbox_view_counts((select a from ids132), null, null, 'all', null, null, null, '00000000-0000-4000-8000-000000013001') where view='waiting'),'counted');
reset role;
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at) values('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d4','00000000-0000-4000-8000-0000001300b9','ZALO','m-g-c','OUTBOUND','5550001','Dạ em xem ạ',(select b from base132) + interval '7 hours 10 minutes',(select b from base132) + interval '7 hours 10 minutes',(select b from base132) + interval '7 hours 10 minutes');
select pg_temp.assert_true((select mention_pending_at is null from public.omnichannel_conversations where id='00000000-0000-4000-8000-0000001300d4'),'answering clears the tag');
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at) values('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d4','00000000-0000-4000-8000-0000001300b9','ZALO','m-g-old','INBOUND','member-9','@Ngân Lê tin cũ tới muộn',(select b from base132) + interval '6 hours 30 minutes',(select b from base132) + interval '6 hours 30 minutes',(select b from base132) + interval '6 hours 30 minutes');
select pg_temp.assert_true((select mention_pending_at is null from public.omnichannel_conversations where id='00000000-0000-4000-8000-0000001300d4'),'a late copy of an old tag does not reopen');
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at) values('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d4','00000000-0000-4000-8000-0000001300b9','ZALO','m-g-d','INBOUND','member-2','@All họp lúc 3h',(select b from base132) + interval '8 hours 0 minutes',(select b from base132) + interval '8 hours 0 minutes',(select b from base132) + interval '8 hours 0 minutes');
select pg_temp.assert_true((select mention_pending_at is not null from public.omnichannel_conversations where id='00000000-0000-4000-8000-0000001300d4'),'@All counts as a tag');
rollback;
