-- Verifies migration 087. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000871','a@test.local'),('00000000-0000-4000-8000-000000000872','b@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000087a1','WS 087');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000087b1','00000000-0000-4000-8000-0000000087a1','Role 087');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000000871','00000000-0000-4000-8000-0000000087a1','A','00000000-0000-4000-8000-0000000087b1',true),
  ('00000000-0000-4000-8000-000000000872','00000000-0000-4000-8000-0000000087a1','B','00000000-0000-4000-8000-0000000087b1',false);
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('00000000-0000-4000-8000-0000000087c1','00000000-0000-4000-8000-0000000087a1','00000000-0000-4000-8000-000000000871','ZALO','ZALO_BRIDGE','nick-1','Nick 1','CONNECTED'),
  ('00000000-0000-4000-8000-0000000087c2','00000000-0000-4000-8000-0000000087a1','00000000-0000-4000-8000-000000000871','ZALO','ZALO_BRIDGE','nick-2','Nick 2','CONNECTED');
insert into public.profile_channel_account_access(workspace_id,profile_id,channel_account_id) values('00000000-0000-4000-8000-0000000087a1','00000000-0000-4000-8000-000000000872','00000000-0000-4000-8000-0000000087c2');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode) values
  ('00000000-0000-4000-8000-0000000087d1','00000000-0000-4000-8000-0000000087a1','00000000-0000-4000-8000-0000000087c1','ZALO','group-1','OPEN','BOT_ALLOWED'),
  ('00000000-0000-4000-8000-0000000087d2','00000000-0000-4000-8000-0000000087a1','00000000-0000-4000-8000-0000000087c2','ZALO','group-1','OPEN','BOT_ALLOWED');
insert into public.omnichannel_messages(id,workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at) values
  ('00000000-0000-4000-8000-0000000087e1','00000000-0000-4000-8000-0000000087a1','00000000-0000-4000-8000-0000000087d1','00000000-0000-4000-8000-0000000087c1','ZALO','m1','OUTBOUND','nick-1','Nick 1 viết',null,'2026-10-01T08:00:00Z','2026-10-01T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000087e2','00000000-0000-4000-8000-0000000087a1','00000000-0000-4000-8000-0000000087d2','00000000-0000-4000-8000-0000000087c2','ZALO','m2','OUTBOUND','nick-2','Nick 2 viết',null,'2026-10-02T08:00:00Z','2026-10-02T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000087e3','00000000-0000-4000-8000-0000000087a1','00000000-0000-4000-8000-0000000087d1','00000000-0000-4000-8000-0000000087c1','ZALO','m3','INBOUND','member-9','Khách viết','2026-10-03T08:00:00Z',null,'2026-10-03T08:00:00Z');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000871',true);
select pg_temp.assert_true((select last_outbound_at from public.get_inbox_last_outbound_at(array['00000000-0000-4000-8000-0000000087d1','00000000-0000-4000-8000-0000000087d2']::uuid[]) where conversation_id='00000000-0000-4000-8000-0000000087d2')='2026-10-02T08:00:00Z'::timestamptz,'last message we sent in each copy (not the customer''s)');
select pg_temp.assert_true((select last_outbound_at from public.get_inbox_last_outbound_at(array['00000000-0000-4000-8000-0000000087d1']::uuid[]))='2026-10-01T08:00:00Z'::timestamptz,'copy of nick 1');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000872',true);
set local role authenticated;
select pg_temp.assert_true((select array_agg(conversation_id) from public.get_inbox_last_outbound_at(array['00000000-0000-4000-8000-0000000087d1','00000000-0000-4000-8000-0000000087d2']::uuid[]))='{00000000-0000-4000-8000-0000000087d2}'::uuid[],'a member only gets copies of nicks they may use');
reset role;
rollback;
