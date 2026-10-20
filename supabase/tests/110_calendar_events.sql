-- Verifies migration 110 (Lịch hẹn; reminder jobs of the Zalo Trợ lý).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
grant execute on function pg_temp.fails(text) to authenticated;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001101','a110@test.local'),('00000000-0000-4000-8000-000000001102','b110@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000110a1','WS 110');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000110b1','00000000-0000-4000-8000-0000000110a1','Role 110');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000001101','00000000-0000-4000-8000-0000000110a1','An','00000000-0000-4000-8000-0000000110b1',true),
  ('00000000-0000-4000-8000-000000001102','00000000-0000-4000-8000-0000000110a1','Bình','00000000-0000-4000-8000-0000000110b1',true);
insert into public.calendar_events(id,workspace_id,title,kind,starts_at,recurrence,recurrence_days,created_by) values
  ('00000000-0000-4000-8000-0000000110e1','00000000-0000-4000-8000-0000000110a1','Họp tuần','HOP','2026-10-19T06:45:00Z','WEEKLY','{1}','00000000-0000-4000-8000-000000001101');
insert into public.calendar_event_attendees(event_id,workspace_id,profile_id,remind_minutes) values
  ('00000000-0000-4000-8000-0000000110e1','00000000-0000-4000-8000-0000000110a1','00000000-0000-4000-8000-000000001101',null),
  ('00000000-0000-4000-8000-0000000110e1','00000000-0000-4000-8000-0000000110a1','00000000-0000-4000-8000-000000001102',15);
select pg_temp.assert_true((select count(*)=2 from public.calendar_event_attendees),'an event keeps its attendees with their own reminder time');
select pg_temp.assert_true(pg_temp.fails($$insert into public.calendar_events(workspace_id,title,starts_at,recurrence_days,created_by) values('00000000-0000-4000-8000-0000000110a1','Sai','2026-10-19T06:45:00Z','{8}','00000000-0000-4000-8000-000000001101')$$),'weekdays are 1..7');
select pg_temp.assert_true(pg_temp.fails($$insert into public.calendar_events(workspace_id,title,starts_at,duration_minutes,created_by) values('00000000-0000-4000-8000-0000000110a1','Sai','2026-10-19T06:45:00Z',2,'00000000-0000-4000-8000-000000001101')$$),'at least 5 minutes');
insert into public.calendar_reminders_sent(event_id,workspace_id,profile_id,occurrence_start) values('00000000-0000-4000-8000-0000000110e1','00000000-0000-4000-8000-0000000110a1','00000000-0000-4000-8000-000000001102','2026-10-26T06:45:00Z');
select pg_temp.assert_true(pg_temp.fails($$insert into public.calendar_reminders_sent(event_id,workspace_id,profile_id,occurrence_start) values('00000000-0000-4000-8000-0000000110e1','00000000-0000-4000-8000-0000000110a1','00000000-0000-4000-8000-000000001102','2026-10-26T06:45:00Z')$$),'one reminder per person and occurrence');
select pg_temp.assert_true((select pg_get_constraintdef(oid) like '%CREATE_EVENT%' from pg_constraint where conname='assistant_actions_kind_allowed'),'Trợ lý may propose events');
select pg_temp.assert_true((select is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='assistant_bot_jobs' and column_name='message_id'),'reminder jobs need no message');
select pg_temp.assert_true((select pg_get_functiondef('public.claim_assistant_bot_job()'::regprocedure) like '%kind = ''QUESTION''%'),'the question worker never claims reminders');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001101',true);
select pg_temp.assert_true(pg_temp.fails($$select count(*) from public.calendar_events$$),'members read events only through the server');
reset role;
rollback;
