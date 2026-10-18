-- Verifies migration 088. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000881','a@test.local'),('00000000-0000-4000-8000-000000000882','b@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000088a1','WS 088');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000088b1','00000000-0000-4000-8000-0000000088a1','Role 088');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000000881','00000000-0000-4000-8000-0000000088a1','A','00000000-0000-4000-8000-0000000088b1',true),
  ('00000000-0000-4000-8000-000000000882','00000000-0000-4000-8000-0000000088a1','B','00000000-0000-4000-8000-0000000088b1',false);
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status) values
  ('00000000-0000-4000-8000-0000000088c1','00000000-0000-4000-8000-0000000088a1','00000000-0000-4000-8000-000000000881','ZALO','ZALO_BRIDGE','100','Nick 1','CONNECTED'),
  ('00000000-0000-4000-8000-0000000088c2','00000000-0000-4000-8000-0000000088a1','00000000-0000-4000-8000-000000000881','ZALO','ZALO_BRIDGE','200','Nick 2','CONNECTED');
insert into public.profile_channel_account_access(workspace_id,profile_id,channel_account_id) values('00000000-0000-4000-8000-0000000088a1','00000000-0000-4000-8000-000000000882','00000000-0000-4000-8000-0000000088c2');
insert into public.zalo_group_members(workspace_id,channel_account_id,group_id,member_id,display_name,avatar_url) values
  ('00000000-0000-4000-8000-0000000088a1','00000000-0000-4000-8000-0000000088c1','900','11','Lan','https://s120.avatar.talk.zdn.vn/a.jpg'),
  ('00000000-0000-4000-8000-0000000088a1','00000000-0000-4000-8000-0000000088c2','901','12','Huy',null);
select pg_temp.assert_true((select count(*) from public.zalo_group_members)=2,'rows stored');
do $$ begin
  begin insert into public.zalo_group_members(workspace_id,channel_account_id,group_id,member_id,display_name) values('00000000-0000-4000-8000-0000000088a1','00000000-0000-4000-8000-0000000088c1','900','13','  '); raise exception 'FAIL: blank name accepted';
  exception when check_violation then raise notice 'PASS: blank name refused'; end;
  begin insert into public.zalo_group_members(workspace_id,channel_account_id,group_id,member_id,display_name,avatar_url) values('00000000-0000-4000-8000-0000000088a1','00000000-0000-4000-8000-0000000088c1','900','14','X','javascript:alert(1)'); raise exception 'FAIL: bad avatar accepted';
  exception when check_violation then raise notice 'PASS: non-http avatar refused'; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000881',true);
select pg_temp.assert_true((select count(*) from public.zalo_group_members)=2,'member with all nicks sees both groups');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000882',true);
set local role authenticated;
select pg_temp.assert_true((select array_agg(display_name) from public.zalo_group_members)='{Huy}','member sees only groups of nicks they may use');
reset role;
rollback;
