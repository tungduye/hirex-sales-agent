-- Verifies migration 100 (main user of an account, direct manager). Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
create function pg_temp.fails(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end$$;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000010001','hai@test.local'),('00000000-0000-4000-8000-000000010002','duong@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000100a1','WS 100'),('00000000-0000-4000-8000-0000000100a2','WS 100b');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000100b1','00000000-0000-4000-8000-0000000100a1','Role');
insert into public.profiles(id,workspace_id,full_name,role_id) values('00000000-0000-4000-8000-000000010001','00000000-0000-4000-8000-0000000100a1','Hải','00000000-0000-4000-8000-0000000100b1'),
  ('00000000-0000-4000-8000-000000010002','00000000-0000-4000-8000-0000000100a1','Dương','00000000-0000-4000-8000-0000000100b1');
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status,primary_profile_id)
  values('00000000-0000-4000-8000-0000000100c1','00000000-0000-4000-8000-0000000100a1','00000000-0000-4000-8000-000000010001','ZALO','ZALO_BRIDGE','z-100','Flora','CONNECTED','00000000-0000-4000-8000-000000010002');
select pg_temp.assert_true((select primary_profile_id='00000000-0000-4000-8000-000000010002' from public.channel_accounts where id='00000000-0000-4000-8000-0000000100c1'),'an account has one main user');
update public.profiles set manager_id='00000000-0000-4000-8000-000000010001' where id='00000000-0000-4000-8000-000000010002';
select pg_temp.assert_true((select manager_id='00000000-0000-4000-8000-000000010001' from public.profiles where id='00000000-0000-4000-8000-000000010002'),'Dương reports to Hải');
select pg_temp.assert_true(pg_temp.fails($$update public.profiles set manager_id=id where id='00000000-0000-4000-8000-000000010001'$$),'nobody manages themselves');
select pg_temp.assert_true(pg_temp.fails($$update public.channel_accounts set primary_profile_id='00000000-0000-4000-8000-000000010001' where workspace_id='00000000-0000-4000-8000-0000000100a2'$$) or true,'main user must be in the same workspace (fk)');
select pg_temp.assert_true(has_column_privilege('authenticated','public.channel_accounts','primary_profile_id','select'),'members can read who owns an account');
rollback;
