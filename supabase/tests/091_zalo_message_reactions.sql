-- Verifies migration 091. Run through run-local.sh.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
grant execute on function pg_temp.assert_true(boolean,text) to authenticated, service_role;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000911','a@test.local'),('00000000-0000-4000-8000-000000000912','b@test.local');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-0000000091a1','WS 091'),('00000000-0000-4000-8000-0000000091a2','Other 091');
insert into public.workspace_roles(id,workspace_id,name) values('00000000-0000-4000-8000-0000000091b1','00000000-0000-4000-8000-0000000091a1','Role'),('00000000-0000-4000-8000-0000000091b2','00000000-0000-4000-8000-0000000091a2','Role');
insert into public.profiles(id,workspace_id,full_name,role_id,all_channel_accounts) values
  ('00000000-0000-4000-8000-000000000911','00000000-0000-4000-8000-0000000091a1','A','00000000-0000-4000-8000-0000000091b1',true),
  ('00000000-0000-4000-8000-000000000912','00000000-0000-4000-8000-0000000091a2','B','00000000-0000-4000-8000-0000000091b2',true);
insert into public.channel_accounts(id,workspace_id,connected_by,channel_type,provider,external_account_id,display_name,status)
  values('00000000-0000-4000-8000-0000000091c1','00000000-0000-4000-8000-0000000091a1','00000000-0000-4000-8000-000000000911','ZALO','ZALO_BRIDGE','zalo-091','Flora','CONNECTED');
insert into public.zalo_message_reactions(workspace_id,channel_account_id,provider_message_id,summary,mine) values
  ('00000000-0000-4000-8000-0000000091a1','00000000-0000-4000-8000-0000000091c1','8382049232094','[{"emoji":"❤️","count":2}]','{❤️}');
do $$ begin
  begin
    insert into public.zalo_message_reactions(workspace_id,channel_account_id,provider_message_id,summary) values
      ('00000000-0000-4000-8000-0000000091a1','00000000-0000-4000-8000-0000000091c1','not-a-number','[{"emoji":"x","count":1}]');
    raise exception 'FAIL: bad message id accepted';
  exception when check_violation then raise notice 'PASS: message id must be numeric';
  end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000911',true);
select pg_temp.assert_true((select count(*)=1 from public.zalo_message_reactions),'members see reactions of nicks they may use');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000912',true);
select pg_temp.assert_true((select count(*)=0 from public.zalo_message_reactions),'another workspace sees nothing');
reset role;
rollback;
