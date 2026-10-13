-- Add granular permissions for the Scan tool suite using least-privilege defaults.
begin;

insert into public.workspace_role_permissions(workspace_id,role_id,permission_key)
select role.workspace_id,role.id,permission.permission_key
from public.workspace_roles role
cross join (values ('scan.view'),('scan.cv'),('scan.website'),('scan.export')) permission(permission_key)
where role.is_system=true and role.name='Quản trị viên'
on conflict (role_id,permission_key) do nothing;

commit;
