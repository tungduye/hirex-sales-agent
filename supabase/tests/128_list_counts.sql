-- Verifies migration 128 (list counts added up in the database).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001281','a128@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000128a1','WS 128');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000128b1','00000000-0000-4000-8000-0000000128a1','Role 128');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values('00000000-0000-4000-8000-0000000128a1','00000000-0000-4000-8000-0000000128b1','campaigns.view');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values('00000000-0000-4000-8000-000000001281','00000000-0000-4000-8000-0000000128a1','A','00000000-0000-4000-8000-0000000128b1',true);
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('00000000-0000-4000-8000-0000000128c1','00000000-0000-4000-8000-0000000128a1','00000000-0000-4000-8000-000000001281','ZALO','ZALO_BRIDGE','n128','N','CONNECTED');
insert into public.contacts(id,workspace_id,full_name) values('00000000-0000-4000-8000-0000000128d1','00000000-0000-4000-8000-0000000128a1','X'),('00000000-0000-4000-8000-0000000128d2','00000000-0000-4000-8000-0000000128a1','Y');
insert into public.channel_campaigns(id,workspace_id,name,created_by) values('00000000-0000-4000-8000-0000000128e1','00000000-0000-4000-8000-0000000128a1','C','00000000-0000-4000-8000-000000001281');
insert into public.channel_campaign_steps(id,workspace_id,campaign_id,position,text_template,allowed_channels) values('00000000-0000-4000-8000-0000000128f1','00000000-0000-4000-8000-0000000128a1','00000000-0000-4000-8000-0000000128e1',1,'Hi',array['ZALO']);
insert into public.channel_campaign_recipients(id,workspace_id,campaign_id,contact_id) values
  ('00000000-0000-4000-8000-000000012801','00000000-0000-4000-8000-0000000128a1','00000000-0000-4000-8000-0000000128e1','00000000-0000-4000-8000-0000000128d1'),
  ('00000000-0000-4000-8000-000000012802','00000000-0000-4000-8000-0000000128a1','00000000-0000-4000-8000-0000000128e1','00000000-0000-4000-8000-0000000128d2');
insert into public.channel_campaign_recipient_steps(workspace_id,campaign_id,recipient_id,step_id,channel_account_id,channel_type,status,idempotency_key) values
  ('00000000-0000-4000-8000-0000000128a1','00000000-0000-4000-8000-0000000128e1','00000000-0000-4000-8000-000000012801','00000000-0000-4000-8000-0000000128f1','00000000-0000-4000-8000-0000000128c1','ZALO','SENT','k128');
grant select on public.channel_campaigns, public.channel_campaign_recipients, public.channel_campaign_recipient_steps, public.channel_outbound_actions, public.channel_delivery_events to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001281',true);
select pg_temp.assert_true((select quantity=2 and sent=1 and replies=0 from public.channel_campaign_list_counts(array['00000000-0000-4000-8000-0000000128e1']::uuid[])),'campaign list counts');
select pg_temp.assert_true((select count(*)=1 from public.channel_delivery_summary() where kind='EVENT_ACTIONS'),'delivery summary answers');
reset role;
select pg_temp.assert_true((select count(*)=0 from public.email_campaign_list_counts('00000000-0000-4000-8000-0000000128a1')),'email counts: no campaigns, no rows');
rollback;
