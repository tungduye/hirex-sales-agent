-- Verifies migrations 093 and 094 (file replies). Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated, service_role;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000009301','a93@test.local'),('00000000-0000-4000-8000-000000009302','b93@test.local'),('00000000-0000-4000-8000-000000009303','c93@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000093a1','WS 093');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000093b1','00000000-0000-4000-8000-0000000093a1','Reply'),('00000000-0000-4000-8000-0000000093b2','00000000-0000-4000-8000-0000000093a1','Viewer');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values('00000000-0000-4000-8000-0000000093a1','00000000-0000-4000-8000-0000000093b1','inbox.reply');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000009301','00000000-0000-4000-8000-0000000093a1','A','00000000-0000-4000-8000-0000000093b1',true),
  ('00000000-0000-4000-8000-000000009302','00000000-0000-4000-8000-0000000093a1','B','00000000-0000-4000-8000-0000000093b1',true),
  ('00000000-0000-4000-8000-000000009303','00000000-0000-4000-8000-0000000093a1','C','00000000-0000-4000-8000-0000000093b2',true);
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status)
  values('00000000-0000-4000-8000-0000000093c1','00000000-0000-4000-8000-0000000093a1','00000000-0000-4000-8000-000000009301','ZALO','ZALO_BRIDGE','zalo-093','Flora','CONNECTED');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata) values
  ('00000000-0000-4000-8000-0000000093d1','00000000-0000-4000-8000-0000000093a1','00000000-0000-4000-8000-0000000093c1','ZALO','person-93','OPEN','BOT_ALLOWED','{}');
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,recipient_external_ids,text_content,received_at)
  values('00000000-0000-4000-8000-0000000093a1','00000000-0000-4000-8000-0000000093d1','00000000-0000-4000-8000-0000000093c1','ZALO','in-93','INBOUND','person-93',array['zalo-093'],'Gửi CV giúp em',now());
insert into public.channel_attachments(id,workspace_id,storage_bucket,storage_path,filename,content_type,size_bytes,sha256,source,created_by) values
  ('00000000-0000-4000-8000-0000000093f1','00000000-0000-4000-8000-0000000093a1','channel-attachments','x/outbound/1.pdf','CV.pdf','application/pdf',100,repeat('a',64),'HUMAN_UPLOAD','00000000-0000-4000-8000-000000009301'),
  ('00000000-0000-4000-8000-0000000093f2','00000000-0000-4000-8000-0000000093a1','channel-attachments','x/outbound/2.pdf','B.pdf','application/pdf',100,repeat('b',64),'HUMAN_UPLOAD','00000000-0000-4000-8000-000000009302'),
  ('00000000-0000-4000-8000-0000000093f3','00000000-0000-4000-8000-0000000093a1','channel-attachments','x/in/3.jpg','in.jpg','image/jpeg',100,repeat('c',64),'INBOUND_PROVIDER',null);

-- A stand-in proposal left by the first version is removed by 094.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009301',true);
create temp table ids(name text, id uuid) on commit drop;
grant all on ids to authenticated;
select pg_temp.assert_true(not exists(select 1 from pg_proc where proname='attach_file_to_zalo_reply'),'two-step version removed');
select pg_temp.assert_true(public.propose_zalo_file_reply('00000000-0000-4000-8000-0000000093d1','00000000-0000-4000-8000-0000000093f2','k-93-0') is null,'cannot send a file another member uploaded');
select pg_temp.assert_true(public.propose_zalo_file_reply('00000000-0000-4000-8000-0000000093d1','00000000-0000-4000-8000-0000000093f3','k-93-0') is null,'cannot send a received file');
insert into ids select 'a1', public.propose_zalo_file_reply('00000000-0000-4000-8000-0000000093d1','00000000-0000-4000-8000-0000000093f1','k-93-1');
select pg_temp.assert_true((select id is not null from ids where name='a1'),'own upload proposed');
select pg_temp.assert_true(public.propose_zalo_file_reply('00000000-0000-4000-8000-0000000093d1','00000000-0000-4000-8000-0000000093f1','k-93-2') is null,'one upload is sent at most once');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009303',true);
select pg_temp.assert_true(public.propose_zalo_file_reply('00000000-0000-4000-8000-0000000093d1','00000000-0000-4000-8000-0000000093f1','k-93-3') is null,'members without reply permission cannot send files');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009301',true);
select pg_temp.assert_true(public.approve_channel_outbound_action((select id from ids where name='a1')),'the file reply is approved like a text reply');
reset role;
select pg_temp.assert_true((select text_content is null and attachment_ids=array['00000000-0000-4000-8000-0000000093f1'::uuid] and status='APPROVED' and recipient_external_id='person-93' from public.channel_outbound_actions where id=(select id from ids where name='a1')),'action is the file only, to the last writer');
select pg_temp.assert_true((select count(*)=1 from public.audit_logs where entity_id=(select id from ids where name='a1') and action='CHANNEL_MESSAGE_PROPOSED'),'proposal audited');
update public.channel_outbound_actions set status='FAILED',attempt_count=1,safe_error_code='ACCOUNT_BUSY' where id=(select id from ids where name='a1');
set local role authenticated;
select pg_temp.assert_true(public.propose_zalo_file_reply('00000000-0000-4000-8000-0000000093d1','00000000-0000-4000-8000-0000000093f1','k-93-4') is not null,'after a definite failure the same file can be sent again');
reset role;
select pg_temp.assert_true(not has_function_privilege('anon','public.propose_zalo_file_reply(uuid,uuid,text)','execute'),'anonymous cannot call');
rollback;
