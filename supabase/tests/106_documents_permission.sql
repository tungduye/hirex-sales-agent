-- Verifies migration 106 (documents.view is a valid key and can be granted to a role).
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin if value is not true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end$$;
insert into public.workspaces(id,name) values('99000000-0000-4000-8000-000000000601','WS 106');
insert into public.workspace_roles(id,workspace_id,name) values('99000000-0000-4000-8000-000000000602','99000000-0000-4000-8000-000000000601','Người đọc tài liệu');
insert into public.workspace_role_permissions(workspace_id,role_id,permission_key) values('99000000-0000-4000-8000-000000000601','99000000-0000-4000-8000-000000000602','documents.view');
select pg_temp.assert_true((select count(*)=1 from public.workspace_role_permissions where role_id='99000000-0000-4000-8000-000000000602' and permission_key='documents.view'),'a role can be granted Tài liệu · Xem');
rollback;
