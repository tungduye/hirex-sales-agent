-- Verifies migration 141 (Thông tin ứng viên tự ghi: nick tuyển dụng, the per-conversation queue, history table).
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
-- The Zalo nick (b9) becomes a nick tuyển dụng: its last 30 days of one-to-one chats with candidate messages are queued once.
update public.channel_accounts set candidate_facts_enabled = true where id='00000000-0000-4000-8000-0000001300b9';
select pg_temp.assert_true(public.queue_candidate_facts_backfill(array['00000000-0000-4000-8000-0000001300b9']::uuid[], 30) = 4,'backfill queues the one-to-one chats (not the named group)');
select pg_temp.assert_true(not exists (select 1 from public.candidate_fact_jobs where conversation_id='00000000-0000-4000-8000-0000001300d4'),'a group is not queued');
select pg_temp.assert_true(not exists (select 1 from public.candidate_fact_jobs where conversation_id='00000000-0000-4000-8000-0000001300d1'),'an e-mail chat is not queued');
select pg_temp.assert_true(public.queue_candidate_facts_backfill(array['00000000-0000-4000-8000-0000001300b9']::uuid[], 30) = 0,'queued once');
delete from public.candidate_fact_jobs;
-- A candidate message queues the chat a minute later; a burst stays one row.
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,created_at) values
  ('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d7','00000000-0000-4000-8000-0000001300b9','ZALO','m141-1','INBOUND','person-7','BrsE em nhé',now(),now()),
  ('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d7','00000000-0000-4000-8000-0000001300b9','ZALO','m141-2','INBOUND','person-7','anh ở Hà Nội',now(),now());
select pg_temp.assert_true((select count(*)=1 and min(due_at) > now() + interval '50 seconds' from public.candidate_fact_jobs),'one job, due in about a minute');
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,sent_at,created_at) values
  ('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d8','00000000-0000-4000-8000-0000001300b9','ZALO','m141-3','OUTBOUND','nick-130','Chào anh',now(),now());
select pg_temp.assert_true((select count(*)=1 from public.candidate_fact_jobs),'our own messages queue nothing');
update public.channel_accounts set candidate_facts_enabled = false where id='00000000-0000-4000-8000-0000001300b9';
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,created_at) values
  ('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d8','00000000-0000-4000-8000-0000001300b9','ZALO','m141-4','INBOUND','person-8','Chào em',now(),now());
select pg_temp.assert_true((select count(*)=1 from public.candidate_fact_jobs),'a nick that is not a nick tuyển dụng queues nothing');
update public.channel_accounts set candidate_facts_enabled = true where id='00000000-0000-4000-8000-0000001300b9';
-- The worker takes due jobs only; a message during the run makes it run again.
select pg_temp.assert_true((select count(*)=0 from public.claim_candidate_fact_jobs(5)),'not due yet');
update public.candidate_fact_jobs set due_at = now() - interval '1 second';
select pg_temp.assert_true((select count(*)=1 from public.claim_candidate_fact_jobs(5)),'claimed');
select pg_temp.assert_true((select status='RUNNING' and attempts=1 from public.candidate_fact_jobs),'running');
select pg_temp.assert_true((select count(*)=0 from public.claim_candidate_fact_jobs(5)),'not claimed twice');
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,created_at) values
  ('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d7','00000000-0000-4000-8000-0000001300b9','ZALO','m141-5','INBOUND','person-7','lương 60tr',now(),now());
select pg_temp.assert_true((select status='RUNNING' and requeue from public.candidate_fact_jobs),'a new message while running is remembered');
select public.finish_candidate_fact_job('00000000-0000-4000-8000-0000001300d7','DONE',now(),null);
select pg_temp.assert_true((select status='PENDING' and not requeue and processed_through is not null from public.candidate_fact_jobs),'runs again for the new message');
update public.candidate_fact_jobs set due_at = now() - interval '1 second';
select pg_temp.assert_true((select count(*)=1 from public.claim_candidate_fact_jobs(5)),'claimed again');
select public.finish_candidate_fact_job('00000000-0000-4000-8000-0000001300d7','FAILED',null,'AI_500');
select pg_temp.assert_true((select status='PENDING' and last_error='AI_500' and due_at > now() + interval '4 minutes' from public.candidate_fact_jobs),'a failure retries later');
update public.candidate_fact_jobs set due_at = now() - interval '1 second';
select pg_temp.assert_true((select count(*)=1 from public.claim_candidate_fact_jobs(5)),'claimed a third time');
select public.finish_candidate_fact_job('00000000-0000-4000-8000-0000001300d7','WAIT',null,'AI_429');
select pg_temp.assert_true((select status='PENDING' and attempts=0 and due_at > now() + interval '29 minutes' from public.candidate_fact_jobs),'no AI credit: waits 30 minutes, attempt not used up');
-- History rows: one value per row, members cannot reach the tables directly.
insert into public.candidate_fact_history(workspace_id,conversation_id,field_key,value,quote,source) values('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d7','careerTrack','BrSE','BrsE em nhé','AI_CHAT');
do $$ begin insert into public.candidate_fact_history(workspace_id,conversation_id,field_key,value,source) values('00000000-0000-4000-8000-0000001300a1','00000000-0000-4000-8000-0000001300d7','careerTrack','x','BOT'); raise exception 'FAIL: unknown source accepted'; exception when check_violation then raise notice 'PASS: only known sources'; end $$;
grant select on public.candidate_fact_history, public.candidate_fact_jobs to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000013001',true);
select pg_temp.assert_true((select count(*)=0 from public.candidate_fact_history),'row level security hides history from members (server only)');
do $$ begin perform public.claim_candidate_fact_jobs(1); raise exception 'FAIL: member can claim'; exception when insufficient_privilege then raise notice 'PASS: only the server claims jobs'; end $$;
reset role;
rollback;
