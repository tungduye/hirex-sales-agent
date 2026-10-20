-- 106: "Tài liệu · Xem" (documents.view): reading the document library and asking Trợ lý about it, on the
-- web and on Zalo, is now a permission granted per role. Administrators keep it; updating the library from
-- Human stays admin-only.
begin;
insert into public.workspace_role_permissions(workspace_id, role_id, permission_key)
select role.workspace_id, role.id, 'documents.view'
from public.workspace_roles role
where role.is_system = true and role.name = 'Quản trị viên'
on conflict (role_id, permission_key) do nothing;
commit;
