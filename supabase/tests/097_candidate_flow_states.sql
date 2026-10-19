-- Verifies migration 097 (Luồng Rec state). Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated, service_role;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000009701','a97@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000097a1','WS 097');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000097b1','00000000-0000-4000-8000-0000000097a1','Role');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values('00000000-0000-4000-8000-000000009701','00000000-0000-4000-8000-0000000097a1','A','00000000-0000-4000-8000-0000000097b1',true);
insert into public.contacts(id,workspace_id,full_name) values('00000000-0000-4000-8000-0000000097f1','00000000-0000-4000-8000-0000000097a1','UV');
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status)
  values('00000000-0000-4000-8000-0000000097c1','00000000-0000-4000-8000-0000000097a1','00000000-0000-4000-8000-000000009701','ZALO','ZALO_BRIDGE','zalo-097','Flora','CONNECTED');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata) values
  ('00000000-0000-4000-8000-0000000097d1','00000000-0000-4000-8000-0000000097a1','00000000-0000-4000-8000-0000000097c1','ZALO','p-97','OPEN','BOT_ALLOWED','{}');
insert into public.candidate_flow_states(workspace_id,contact_id,step,facts) values('00000000-0000-4000-8000-0000000097a1','00000000-0000-4000-8000-0000000097f1',4,'{"careerTrack":"BrSE"}');
insert into public.candidate_flow_states(workspace_id,conversation_id,step) values('00000000-0000-4000-8000-0000000097a1','00000000-0000-4000-8000-0000000097d1',2);
select pg_temp.assert_true((select count(*)=2 from public.candidate_flow_states),'a state per contact, or per conversation without a contact');
do $$ begin
  insert into public.candidate_flow_states(workspace_id,contact_id) values('00000000-0000-4000-8000-0000000097a1','00000000-0000-4000-8000-0000000097f1');
  raise exception 'FAIL: two states for one contact';
exception when unique_violation then raise notice 'PASS: one state per contact'; end $$;
do $$ begin
  insert into public.candidate_flow_states(workspace_id,conversation_id,step) values('00000000-0000-4000-8000-0000000097a1','00000000-0000-4000-8000-0000000097d1',9);
  raise exception 'FAIL: step 9 accepted';
exception when check_violation then raise notice 'PASS: steps are 1 to 8'; end $$;
select pg_temp.assert_true(not has_table_privilege('authenticated','public.candidate_flow_states','select'),'members read it only through the server');
rollback;
