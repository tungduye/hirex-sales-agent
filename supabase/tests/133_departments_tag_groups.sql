-- Verifies migration 133 (Bộ phận, nhóm thẻ, facts Soda counts by).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001331','a133@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000133a1','WS 133');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000133b1','00000000-0000-4000-8000-0000000133a1','Role 133');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts,department) values('00000000-0000-4000-8000-000000001331','00000000-0000-4000-8000-0000000133a1','Hải','00000000-0000-4000-8000-0000000133b1',true,'Sale');
select pg_temp.assert_true(pg_temp.fails($$update public.profiles set department='  ' where id='00000000-0000-4000-8000-000000001331'$$),'blank department refused');
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status,primary_profile_id) values
  ('00000000-0000-4000-8000-0000000133c1','00000000-0000-4000-8000-0000000133a1','00000000-0000-4000-8000-000000001331','ZALO','ZALO_BRIDGE','n133','Nick','CONNECTED','00000000-0000-4000-8000-000000001331');
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,metadata,last_message_at) values
  ('00000000-0000-4000-8000-0000000133d1','00000000-0000-4000-8000-0000000133a1','00000000-0000-4000-8000-0000000133c1','ZALO','p1','OPEN','BOT_ALLOWED','{"important":true}',now()),
  ('00000000-0000-4000-8000-0000000133d2','00000000-0000-4000-8000-0000000133a1','00000000-0000-4000-8000-0000000133c1','ZALO','p2','OPEN','BOT_ALLOWED','{}',now() - interval '1 hour');
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at) values
  ('00000000-0000-4000-8000-0000000133a1','00000000-0000-4000-8000-0000000133d1','00000000-0000-4000-8000-0000000133c1','ZALO','m1','INBOUND','p1','Chào',now(),now(),now()),
  ('00000000-0000-4000-8000-0000000133a1','00000000-0000-4000-8000-0000000133d2','00000000-0000-4000-8000-0000000133c1','ZALO','m2','OUTBOUND','n133','Chào',now(),now(),now());
set local session_replication_role = replica;
insert into public.conversation_tags(id,workspace_id,name,group_name) values('00000000-0000-4000-8000-0000000133e1','00000000-0000-4000-8000-0000000133a1','IT Nhật','Thị trường'),('00000000-0000-4000-8000-0000000133e2','00000000-0000-4000-8000-0000000133a1','BrSE',null);
insert into public.conversation_tag_links(workspace_id,conversation_id,tag_id) values('00000000-0000-4000-8000-0000000133a1','00000000-0000-4000-8000-0000000133d1','00000000-0000-4000-8000-0000000133e1'),('00000000-0000-4000-8000-0000000133a1','00000000-0000-4000-8000-0000000133d1','00000000-0000-4000-8000-0000000133e2');
set local session_replication_role = origin;
grant select on public.contacts, public.omnichannel_conversations, public.omnichannel_messages, public.conversation_tag_links to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001331',true);
select pg_temp.assert_true((select count(*)=2 from public.inbox_conversation_facts(array['00000000-0000-4000-8000-0000000133c1']::uuid[], null, null)),'one row per conversation');
select pg_temp.assert_true((select is_important and latest_direction='INBOUND' and cardinality(tag_ids)=2 from public.inbox_conversation_facts(array['00000000-0000-4000-8000-0000000133c1']::uuid[], null, null) where id='00000000-0000-4000-8000-0000000133d1'),'important, waiting, with its tags');
select pg_temp.assert_true((select count(*)=1 from public.inbox_conversation_facts(array['00000000-0000-4000-8000-0000000133c1']::uuid[], null, null, array['00000000-0000-4000-8000-0000000133e2']::uuid[])),'only conversations with the asked tags');
select pg_temp.assert_true((select jsonb_array_length(public.inbox_conversation_summary(array['00000000-0000-4000-8000-0000000133c1']::uuid[], null, null))=2 and (select sum((x->>'c')::int) from jsonb_array_elements(public.inbox_conversation_summary(array['00000000-0000-4000-8000-0000000133c1']::uuid[], null, null)) x)=2),'summary adds up in the database');
select pg_temp.assert_true((select bool_or((x->>'w')::boolean and (x->>'i')::boolean) from jsonb_array_elements(public.inbox_conversation_summary(array['00000000-0000-4000-8000-0000000133c1']::uuid[], null, null)) x),'waiting and important flags');
reset role;
rollback;
