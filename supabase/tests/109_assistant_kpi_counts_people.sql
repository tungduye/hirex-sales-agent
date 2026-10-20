-- Verifies migration 109 (KPI: chats that really started in the period, people vs groups).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.fails(text) to authenticated;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;

insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001091','a109@test.local'),('00000000-0000-4000-8000-000000001092','b109@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000109a1','WS 109');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000109b1','00000000-0000-4000-8000-0000000109a1','Role 109');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000001091','00000000-0000-4000-8000-0000000109a1','An','00000000-0000-4000-8000-0000000109b1',true),
  ('00000000-0000-4000-8000-000000001092','00000000-0000-4000-8000-0000000109a1','Bình','00000000-0000-4000-8000-0000000109b1',true);
insert into public.email_accounts(id,workspace_id,connected_by,provider,email_address,status,scopes) values('00000000-0000-4000-8000-0000000109f1','00000000-0000-4000-8000-0000000109a1','00000000-0000-4000-8000-000000001091','GMAIL','a109@mail.test','CONNECTED',array['https://www.googleapis.com/auth/gmail.send']);
create temp table acc109 as select id from public.channel_accounts where legacy_email_account_id='00000000-0000-4000-8000-0000000109f1';
update public.channel_accounts set primary_profile_id='00000000-0000-4000-8000-000000001091' where id=(select id from acc109);
insert into public.omnichannel_conversations(id,workspace_id,channel_account_id,channel_type,provider_conversation_id,status,takeover_mode,unread_count,metadata,created_at) values
  ('00000000-0000-4000-8000-0000000109d1','00000000-0000-4000-8000-0000000109a1',(select id from acc109),'EMAIL','th1','OPEN','BOT_ALLOWED',1,'{}','2026-10-10T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000109d2','00000000-0000-4000-8000-0000000109a1',(select id from acc109),'EMAIL','th2','OPEN','BOT_ALLOWED',0,'{}','2026-09-01T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000109d3','00000000-0000-4000-8000-0000000109a1',(select id from acc109),'EMAIL','th3','OPEN','BOT_ALLOWED',3,'{"isGroup":true}','2026-10-12T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000109d4','00000000-0000-4000-8000-0000000109a1',(select id from acc109),'EMAIL','th4','OPEN','BOT_ALLOWED',0,'{}','2026-10-12T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000109d5','00000000-0000-4000-8000-0000000109a1',(select id from acc109),'EMAIL','th5','OPEN','BOT_ALLOWED',2,'{}','2026-10-12T08:00:00Z');
insert into public.omnichannel_messages(workspace_id,conversation_id,channel_account_id,channel_type,provider_message_id,direction,sender_external_id,text_content,received_at,sent_at,created_at) values
  ('00000000-0000-4000-8000-0000000109a1','00000000-0000-4000-8000-0000000109d1',(select id from acc109),'EMAIL','m1','INBOUND','x@y.vn','1','2026-10-10T08:00:00Z',null,'2026-10-10T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000109a1','00000000-0000-4000-8000-0000000109d1',(select id from acc109),'EMAIL','m2','INBOUND','x@y.vn','2','2026-10-11T08:00:00Z',null,'2026-10-11T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000109a1','00000000-0000-4000-8000-0000000109d1',(select id from acc109),'EMAIL','m3','OUTBOUND','a109@mail.test','3',null,'2026-10-11T09:00:00Z','2026-10-11T09:00:00Z'),
  ('00000000-0000-4000-8000-0000000109a1','00000000-0000-4000-8000-0000000109d2',(select id from acc109),'EMAIL','m4','INBOUND','z@y.vn','old','2026-09-01T08:00:00Z',null,'2026-10-11T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000109a1','00000000-0000-4000-8000-0000000109d3',(select id from acc109),'EMAIL','m5','INBOUND','g@y.vn','group','2026-10-12T08:00:00Z',null,'2026-10-12T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000109a1','00000000-0000-4000-8000-0000000109d4',(select id from acc109),'EMAIL','m6','INBOUND','h@y.vn','synced late','2026-08-01T08:00:00Z',null,'2026-10-12T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000109a1','00000000-0000-4000-8000-0000000109d4',(select id from acc109),'EMAIL','m7','INBOUND','h@y.vn','again','2026-10-12T09:00:00Z',null,'2026-10-12T09:00:00Z'),
  ('00000000-0000-4000-8000-0000000109a1','00000000-0000-4000-8000-0000000109d5',(select id from acc109),'EMAIL','m8','INBOUND','no-reply@accounts.google.com','alert','2026-10-12T08:00:00Z',null,'2026-10-12T08:00:00Z');
insert into public.channel_tasks(workspace_id,title,status,assigned_to,due_at,created_by) values
  ('00000000-0000-4000-8000-0000000109a1','Gọi lại','OPEN','00000000-0000-4000-8000-000000001091','2026-01-01T00:00:00Z','00000000-0000-4000-8000-000000001092'),
  ('00000000-0000-4000-8000-0000000109a1','Gửi JD','OPEN','00000000-0000-4000-8000-000000001091','2099-01-01T00:00:00Z','00000000-0000-4000-8000-000000001092');
insert into public.candidate_flow_states(workspace_id,conversation_id,step,outcome,updated_by,created_at,updated_at) values
  ('00000000-0000-4000-8000-0000000109a1','00000000-0000-4000-8000-0000000109d1',8,'CV_RECEIVED','00000000-0000-4000-8000-000000001091','2026-10-10T08:00:00Z','2026-10-12T08:00:00Z');
create temp table kpi109 as select public.assistant_kpi_counts('00000000-0000-4000-8000-0000000109a1',array['00000000-0000-4000-8000-000000001091','00000000-0000-4000-8000-000000001092']::uuid[],'2026-10-05T00:00:00Z','2026-10-15T00:00:00Z') as v;
select pg_temp.assert_true((select jsonb_array_length(v)=2 from kpi109),'one row per member');
select pg_temp.assert_true((select (e->'accounts'->0->>'inbound')::int=5 and (e->'accounts'->0->>'outbound')::int=1 and (e->'accounts'->0->>'conversations_in')::int=4 from kpi109, jsonb_array_elements(v) e where e->>'name'='An'),'messages on the nick owner, old history left out');
select pg_temp.assert_true((select (e->'accounts'->0->>'new_conversations')::int=2 and (e->'accounts'->0->>'new_groups')::int=1 from kpi109, jsonb_array_elements(v) e where e->>'name'='An'),'new chats: synced-late history is not new, groups apart');
select pg_temp.assert_true((select (e->'accounts'->0->>'unread')::int=1 and (e->'accounts'->0->>'unread_groups')::int=1 from kpi109, jsonb_array_elements(v) e where e->>'name'='An'),'unread people leave out robots, groups apart');
select pg_temp.assert_true((select (e->>'tasks_open')::int=2 and (e->>'tasks_overdue')::int=1 from kpi109, jsonb_array_elements(v) e where e->>'name'='An'),'open and overdue tasks of the assignee');
select pg_temp.assert_true((select (e->>'rec_new')::int=1 and (e->>'rec_cv')::int=1 from kpi109, jsonb_array_elements(v) e where e->>'name'='An'),'Rec candidates and CVs');
select pg_temp.assert_true((select jsonb_array_length(e->'accounts')=0 and (e->>'tasks_open')::int=0 from kpi109, jsonb_array_elements(v) e where e->>'name'='Bình'),'a member without nicks has zeros');
set local role authenticated;
select pg_temp.assert_true(pg_temp.fails($$select public.assistant_kpi_counts('00000000-0000-4000-8000-0000000109a1',array[]::uuid[],now(),now())$$),'members cannot call it directly');
reset role;
rollback;
