-- 095: "Tài khoản" menu (the account manager site shown inside HireX). New permission accounts.view:
-- granted to administrators; other roles get it in Settings > Roles.
begin;
insert into public.workspace_role_permissions(workspace_id, role_id, permission_key)
select role.workspace_id, role.id, 'accounts.view'
from public.workspace_roles role
where role.is_system = true and role.name = 'Quản trị viên'
on conflict (role_id, permission_key) do nothing;
commit;
