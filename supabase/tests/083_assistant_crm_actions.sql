-- Verifies migration 083. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000831','a@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000008aa','WS 083');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000008ba','00000000-0000-4000-8000-0000000008aa','Staff 083');
insert into public.profiles(id,workspace_id,full_name,role_id) values('00000000-0000-4000-8000-000000000831','00000000-0000-4000-8000-0000000008aa','A','00000000-0000-4000-8000-0000000008ba');
insert into public.assistant_actions(workspace_id,user_id,kind)
select '00000000-0000-4000-8000-0000000008aa','00000000-0000-4000-8000-000000000831',k
from unnest(array['CREATE_CONTACT','UPDATE_CONTACT','ADD_NOTE','CREATE_COMPANY','UPDATE_COMPANY','UPDATE_TASK','SEND_REPLY','CREATE_RULE','CREATE_TASK']) k;
select pg_temp.assert_true((select count(*) from public.assistant_actions where workspace_id='00000000-0000-4000-8000-0000000008aa')=9,'new CRM kinds and the earlier kinds are accepted');
select pg_temp.assert_true(pg_temp.fails($$insert into public.assistant_actions(workspace_id,user_id,kind) values('00000000-0000-4000-8000-0000000008aa','00000000-0000-4000-8000-000000000831','DELETE_CONTACT')$$),'delete kinds are still refused');
rollback;
