-- Verifies migration 069. Run through supabase/tests/run-local.sh (disposable database,
-- local_postgres_supabase_bootstrap.sql + every migration).
-- Everything runs inside one transaction and is rolled back.
begin;
-- The AI Recruiter worker and the server actions use the service-role client.
select set_config('request.jwt.claim.role','service_role',true);
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;

-- Fixture: one workspace, one admin, one Zalo account, one conversation with an inbound message, one bot bound to the account.
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000001','admin@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000000a1','WS 069');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000a1','Test role 069');
insert into public.profiles(id,workspace_id,full_name,role_id) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000a1','Admin','00000000-0000-4000-8000-0000000000b1');
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status)
  values('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000001','ZALO','ZALO_BRIDGE','zalo-069','Zalo 069','CONNECTED');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata)
  values('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000c1','ZALO','conv-069','OPEN','BOT_ALLOWED','{"aiRecruiterModeOverride":"DRAFT"}');
insert into public.omnichannel_messages(id,workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at)
  values('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','ZALO','msg-069','INBOUND','candidate-069','Chào em',now());
insert into public.ai_recruiter_bots(id,workspace_id,name,enabled,mode,created_by,bot_type)
  values('00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000a1','Bot 069',true,'DRAFT','00000000-0000-4000-8000-000000000001','RECRUITER');
insert into public.ai_recruiter_channel_bindings(workspace_id,bot_id,channel_account_id,enabled)
  values('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000c1',true);
insert into public.ai_recruiter_runs(id,workspace_id,bot_id,conversation_id,inbound_message_id,status,mode,proposed_text_parts)
  values('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000e1','RUNNING','AUTO',array['Dạ em chào anh']);

create function pg_temp.propose() returns uuid language sql as $$
  select public.propose_ai_recruiter_message_service('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000101','Dạ em chào anh',1)
$$;
create function pg_temp.audits(p_action text) returns bigint language sql as $$
  select count(*) from public.audit_logs where workspace_id='00000000-0000-4000-8000-0000000000a1' and action=p_action
$$;

-- Privileges
select pg_temp.assert_true(not has_function_privilege('authenticated','public.propose_ai_recruiter_message_service(uuid,uuid,text,integer)','execute'),'browser cannot propose AUTO messages');
select pg_temp.assert_true(has_function_privilege('service_role','public.propose_ai_recruiter_message_service(uuid,uuid,text,integer)','execute'),'service role can propose AUTO messages');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.ai_recruiter_audit_actor(uuid,text)','execute'),'browser cannot call audit actor helper');

-- Gap 1: both switches required. The fixture bot was inserted enabled+DRAFT, which is not logged.
select pg_temp.assert_true(pg_temp.audits('AI_RECRUITER_BOT_MODE_CHANGED')=1,'enabled bot insert is audited');
select pg_temp.assert_true(pg_temp.propose() is null,'bot DRAFT + conversation DRAFT: no AUTO send');

update public.omnichannel_conversations set metadata=metadata||'{"aiRecruiterModeOverride":"AUTO"}' where id='00000000-0000-4000-8000-0000000000d1';
select pg_temp.assert_true(pg_temp.propose() is null,'bot DRAFT + conversation AUTO: no AUTO send (052 allowed this)');

update public.ai_recruiter_bots set mode='AUTO' where id='00000000-0000-4000-8000-0000000000f1';
update public.omnichannel_conversations set metadata=metadata||'{"aiRecruiterModeOverride":"DRAFT"}' where id='00000000-0000-4000-8000-0000000000d1';
select pg_temp.assert_true(pg_temp.propose() is null,'bot AUTO + conversation DRAFT: no AUTO send (052 allowed this)');

update public.omnichannel_conversations set metadata=metadata||'{"aiRecruiterModeOverride":"AUTO"}' where id='00000000-0000-4000-8000-0000000000d1';
create temporary table t_action as select pg_temp.propose() as id;
select pg_temp.assert_true((select id from t_action) is not null,'bot AUTO + conversation AUTO: action created');

-- Gap 2: no human approver on AUTO actions.
select pg_temp.assert_true(exists(select 1 from public.channel_outbound_actions a join t_action t on t.id=a.id
  where a.status='APPROVED' and a.approved_by is null and a.approved_at is not null and a.proposed_by='AI_ASSIST' and a.dispatch_source='AI_AUTOMATION'),'AUTO action has no human approver');
select pg_temp.assert_true(pg_temp.propose()=(select id from t_action),'proposal stays idempotent');

-- The send pipeline still works without an approver.
select pg_temp.assert_true((select public.claim_channel_outbound_action('00000000-0000-4000-8000-0000000000a1',id,'00000000-0000-4000-8000-000000000201') from t_action) is not null,'executor can claim approver-less AUTO action');
select pg_temp.assert_true((select public.finalize_channel_outbound_action_sent('00000000-0000-4000-8000-0000000000a1',id,'00000000-0000-4000-8000-000000000201','pm-069','pc-069',now()) from t_action),'executor can finalize approver-less AUTO action');
select pg_temp.assert_true(exists(select 1 from public.audit_logs a join t_action t on t.id=a.entity_id where a.action='CHANNEL_MESSAGE_SENT' and a.actor_id is null),'sent audit has no human actor');

-- The relaxed constraint does not open the door for anything else.
do $$begin
  begin
    insert into public.channel_policy_decisions(id,workspace_id,conversation_id,channel_account_id,channel_type,normalized_recipient,allowed,reason_codes,expires_at)
      values('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','ZALO','candidate-069',true,'{}',now()+interval '10 minutes');
    insert into public.channel_outbound_actions(workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,status,text_content,approved_by,approved_at,idempotency_key,policy_decision_id,proposed_by,dispatch_source)
      values('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','ZALO','candidate-069','APPROVED','x',null,now(),'t069-human','00000000-0000-4000-8000-000000000301','HUMAN','HUMAN_MANUAL');
    raise exception 'FAIL: human action without approver was accepted';
  exception when check_violation then raise notice 'PASS: human action still requires an approver';
  end;
  begin
    insert into public.channel_outbound_actions(workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,status,text_content,approved_by,approved_at,idempotency_key,policy_decision_id,proposed_by,dispatch_source)
      values('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','ZALO','candidate-069','APPROVED','x',null,now(),'t069-campaign','00000000-0000-4000-8000-000000000301','HUMAN','CAMPAIGN');
    raise exception 'FAIL: campaign action without approver was accepted';
  exception when check_violation then raise notice 'PASS: campaign action still requires an approver';
  end;
  begin
    insert into public.channel_outbound_actions(workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,status,text_content,approved_by,approved_at,idempotency_key,policy_decision_id,proposed_by,dispatch_source)
      values('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','ZALO','candidate-069','APPROVED','x',null,null,'t069-noapprovedat','00000000-0000-4000-8000-000000000301','AI_ASSIST','AI_AUTOMATION');
    raise exception 'FAIL: AUTO action without approved_at was accepted';
  exception when check_violation then raise notice 'PASS: AUTO action still requires approved_at';
  end;
end$$;

-- Suppression still blocks AUTO.
insert into public.ai_recruiter_runs(id,workspace_id,bot_id,conversation_id,inbound_message_id,status,mode,proposed_text_parts)
  values('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000e1','RUNNING','AUTO',array['Tin thứ hai'])
  on conflict do nothing;
insert into public.channel_suppressions(workspace_id,channel_type,normalized_recipient,reason,source)
  values('00000000-0000-4000-8000-0000000000a1','ZALO','candidate-069','MANUAL','test-069');
select pg_temp.assert_true(public.propose_ai_recruiter_message_service('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000102','Tin thứ hai',1) is null,'suppressed recipient: no AUTO send');

-- Gap 3: bot mode changes are audited with the acting admin, and the actor field is single-use.
delete from public.audit_logs where workspace_id='00000000-0000-4000-8000-0000000000a1' and action like 'AI_RECRUITER_%';
update public.ai_recruiter_bots set mode='DRAFT',mode_change_actor='00000000-0000-4000-8000-000000000001' where id='00000000-0000-4000-8000-0000000000f1';
select pg_temp.assert_true(exists(select 1 from public.audit_logs where action='AI_RECRUITER_BOT_MODE_CHANGED' and entity_id='00000000-0000-4000-8000-0000000000f1'
  and actor_id='00000000-0000-4000-8000-000000000001' and metadata->'from'->>'mode'='AUTO' and metadata->'to'->>'mode'='DRAFT'),'bot mode change audited with admin actor');
select pg_temp.assert_true((select mode_change_actor from public.ai_recruiter_bots where id='00000000-0000-4000-8000-0000000000f1') is null,'bot actor field cleared after use');

update public.ai_recruiter_bots set mode='AUTO' where id='00000000-0000-4000-8000-0000000000f1';
select pg_temp.assert_true(exists(select 1 from public.audit_logs where action='AI_RECRUITER_BOT_MODE_CHANGED' and actor_id is null and metadata->'to'->>'mode'='AUTO'),'bot mode change without actor still audited (actor NULL)');

update public.ai_recruiter_bots set enabled=false,mode_change_actor='00000000-0000-4000-8000-0000000009ff' where id='00000000-0000-4000-8000-0000000000f1';
select pg_temp.assert_true(exists(select 1 from public.audit_logs where action='AI_RECRUITER_BOT_MODE_CHANGED' and actor_id is null and metadata->'to'->>'enabled'='false'),'unknown actor does not block the change and is not recorded');

select pg_temp.assert_true(pg_temp.audits('AI_RECRUITER_BOT_MODE_CHANGED')=3,'exactly three bot audits so far');
update public.ai_recruiter_bots set extra_rules='x' where id='00000000-0000-4000-8000-0000000000f1';
select pg_temp.assert_true(pg_temp.audits('AI_RECRUITER_BOT_MODE_CHANGED')=3,'unrelated bot edits are not audited');

-- Gap 3: conversation override changes are audited; the actor key never persists in metadata.
update public.omnichannel_conversations set metadata=metadata||'{"aiRecruiterModeOverride":"DRAFT","aiRecruiterModeChangedBy":"00000000-0000-4000-8000-000000000001"}' where id='00000000-0000-4000-8000-0000000000d1';
select pg_temp.assert_true(exists(select 1 from public.audit_logs where action='AI_RECRUITER_CONVERSATION_MODE_CHANGED' and entity_id='00000000-0000-4000-8000-0000000000d1'
  and actor_id='00000000-0000-4000-8000-000000000001' and metadata->>'from'='AUTO' and metadata->>'to'='DRAFT'),'conversation override change audited with admin actor');
select pg_temp.assert_true(not ((select metadata from public.omnichannel_conversations where id='00000000-0000-4000-8000-0000000000d1') ? 'aiRecruiterModeChangedBy'),'conversation actor key removed from metadata');

update public.omnichannel_conversations set metadata=metadata||'{"aiRecruiterModeChangedBy":"00000000-0000-4000-8000-000000000001"}' where id='00000000-0000-4000-8000-0000000000d1';
select pg_temp.assert_true(pg_temp.audits('AI_RECRUITER_CONVERSATION_MODE_CHANGED')=1,'actor key without a mode change is dropped, not audited');
select pg_temp.assert_true(not ((select metadata from public.omnichannel_conversations where id='00000000-0000-4000-8000-0000000000d1') ? 'aiRecruiterModeChangedBy'),'stray actor key removed');

update public.omnichannel_conversations set metadata=metadata||'{"note":"x"}' where id='00000000-0000-4000-8000-0000000000d1';
select pg_temp.assert_true(pg_temp.audits('AI_RECRUITER_CONVERSATION_MODE_CHANGED')=1,'unrelated metadata edits are not audited');

rollback;
