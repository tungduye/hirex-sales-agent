-- Verifies migration 090. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated, service_role;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000901','a@test.local'),('00000000-0000-4000-8000-000000000902','b@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000090a1','WS 090'),('00000000-0000-4000-8000-0000000090a2','Other 090');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000090b1','00000000-0000-4000-8000-0000000090a1','Role'),('00000000-0000-4000-8000-0000000090b2','00000000-0000-4000-8000-0000000090a2','Role');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-0000000090a1','A','00000000-0000-4000-8000-0000000090b1',true),
  ('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-0000000090a2','B','00000000-0000-4000-8000-0000000090b2',true);
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status)
  values('00000000-0000-4000-8000-0000000090c1','00000000-0000-4000-8000-0000000090a1','00000000-0000-4000-8000-000000000901','ZALO','ZALO_BRIDGE','zalo-090','Flora','CONNECTED');
insert into public.contacts(id,workspace_id,full_name) values('00000000-0000-4000-8000-0000000090f1','00000000-0000-4000-8000-0000000090a1','Khách');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata) values
  ('00000000-0000-4000-8000-0000000090d1','00000000-0000-4000-8000-0000000090a1','00000000-0000-4000-8000-0000000090c1','ZALO','person-1','OPEN','BOT_ALLOWED','{}');
insert into public.channel_policy_decisions(id,workspace_id,conversation_id,channel_account_id,channel_type,normalized_recipient,allowed,expires_at) values
  ('00000000-0000-4000-8000-0000000090e0','00000000-0000-4000-8000-0000000090a1','00000000-0000-4000-8000-0000000090d1','00000000-0000-4000-8000-0000000090c1','ZALO','person-1',true,now()+interval '1 hour');
insert into public.channel_outbound_actions(id,workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,status,text_content,idempotency_key,policy_decision_id,approved_by,approved_at,attempt_count,execution_lock_id,execution_lock_at) values
  ('00000000-0000-4000-8000-0000000090e1','00000000-0000-4000-8000-0000000090a1','00000000-0000-4000-8000-0000000090d1','00000000-0000-4000-8000-0000000090c1','ZALO','person-1','DELIVERY_UNKNOWN','Chào anh','k-090-1','00000000-0000-4000-8000-0000000090e0','00000000-0000-4000-8000-000000000901',now(),1,gen_random_uuid(),now()),
  ('00000000-0000-4000-8000-0000000090e2','00000000-0000-4000-8000-0000000090a1','00000000-0000-4000-8000-0000000090d1','00000000-0000-4000-8000-0000000090c1','ZALO','person-1','DELIVERY_UNKNOWN','Chào anh 2','k-090-2','00000000-0000-4000-8000-0000000090e0','00000000-0000-4000-8000-000000000901',now(),1,gen_random_uuid(),now());
insert into public.channel_campaigns(id,workspace_id,name,created_by) values('00000000-0000-4000-8000-000000009101','00000000-0000-4000-8000-0000000090a1','Camp 090','00000000-0000-4000-8000-000000000901');
insert into public.channel_campaign_steps(id,workspace_id,campaign_id,position,text_template,allowed_channels,delay_minutes) values
  ('00000000-0000-4000-8000-000000009102','00000000-0000-4000-8000-0000000090a1','00000000-0000-4000-8000-000000009101',1,'Chào',array['ZALO'],0),
  ('00000000-0000-4000-8000-000000009103','00000000-0000-4000-8000-0000000090a1','00000000-0000-4000-8000-000000009101',2,'Nhắc lại',array['ZALO'],60);
insert into public.channel_campaign_recipients(id,workspace_id,campaign_id,contact_id,status,stop_reason) values
  ('00000000-0000-4000-8000-000000009104','00000000-0000-4000-8000-0000000090a1','00000000-0000-4000-8000-000000009101','00000000-0000-4000-8000-0000000090f1','DELIVERY_UNKNOWN','DELIVERY_UNKNOWN');
insert into public.channel_campaign_recipient_steps(id,workspace_id,campaign_id,recipient_id,step_id,channel_account_id,channel_type,recipient_external_id,status,idempotency_key,outbound_action_id) values
  ('00000000-0000-4000-8000-000000009105','00000000-0000-4000-8000-0000000090a1','00000000-0000-4000-8000-000000009101','00000000-0000-4000-8000-000000009104','00000000-0000-4000-8000-000000009102','00000000-0000-4000-8000-0000000090c1','ZALO','person-1','DELIVERY_UNKNOWN','step-090','00000000-0000-4000-8000-0000000090e1');

set local role service_role;
select pg_temp.assert_true(public.confirm_zalo_delivery_unknown_sent('00000000-0000-4000-8000-0000000090a1','00000000-0000-4000-8000-0000000090e1','deplao-1','person-1',now()),'unknown delivery found in Deplao becomes SENT');
select pg_temp.assert_true(public.confirm_zalo_delivery_unknown_sent('00000000-0000-4000-8000-0000000090a1','00000000-0000-4000-8000-0000000090e1','deplao-1','person-1',now()),'confirming again is harmless');
select pg_temp.assert_true(not public.confirm_zalo_delivery_unknown_sent('00000000-0000-4000-8000-0000000090a2','00000000-0000-4000-8000-0000000090e2','deplao-2','person-1',now()),'another workspace cannot confirm');
select pg_temp.assert_true(public.auto_acknowledge_zalo_delivery_unknown('00000000-0000-4000-8000-0000000090a1','00000000-0000-4000-8000-0000000090e2'),'unknown delivery not found is acknowledged without retry');
reset role;
select pg_temp.assert_true((select status='SENT' and provider_message_id='deplao-1' and execution_lock_id is null from public.channel_outbound_actions where id='00000000-0000-4000-8000-0000000090e1'),'action is SENT with the Deplao message id');
select pg_temp.assert_true((select status='SENT' from public.channel_campaign_recipient_steps where id='00000000-0000-4000-8000-000000009105'),'campaign step is SENT');
select pg_temp.assert_true((select status='ACTIVE' and current_step_position=2 and next_step_at>now() from public.channel_campaign_recipients where id='00000000-0000-4000-8000-000000009104'),'campaign recipient continues with the next step');
select pg_temp.assert_true((select count(*)=1 from public.audit_logs where entity_id='00000000-0000-4000-8000-0000000090e1' and action='CHANNEL_MESSAGE_SENT'),'one audit entry');
select pg_temp.assert_true((select status='DELIVERY_UNKNOWN' and reconciliation_status='ACKNOWLEDGED_NO_RETRY' and reconciled_by is null and retry_allowed=false from public.channel_outbound_actions where id='00000000-0000-4000-8000-0000000090e2'),'automatic acknowledgement has no person and never retries');
insert into public.zalo_account_send_locks(channel_account_id,workspace_id,reason,locked_since,action_id,conversation_id,auto_release_at) values
  ('00000000-0000-4000-8000-0000000090c1','00000000-0000-4000-8000-0000000090a1','DELIVERY_UNKNOWN',now(),'00000000-0000-4000-8000-0000000090e2','00000000-0000-4000-8000-0000000090d1',now()+interval '30 minutes');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',true);
select pg_temp.assert_true((select count(*)=1 from public.zalo_account_send_locks),'members see locks of nicks they may use');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000902',true);
select pg_temp.assert_true((select count(*)=0 from public.zalo_account_send_locks),'another workspace sees nothing');
reset role;
rollback;
