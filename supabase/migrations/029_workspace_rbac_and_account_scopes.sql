-- HireX: extensible workspace RBAC and per-user connected-account scopes.
begin;

create table public.workspace_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_roles_name_not_blank check (btrim(name) <> ''),
  constraint workspace_roles_id_workspace_key unique(id,workspace_id)
);
create unique index workspace_roles_workspace_name_key on public.workspace_roles(workspace_id,lower(btrim(name)));
create trigger workspace_roles_set_updated_at before update on public.workspace_roles for each row execute function public.set_updated_at();

create table public.workspace_role_permissions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role_id uuid not null,
  permission_key text not null,
  created_at timestamptz not null default now(),
  primary key(role_id,permission_key),
  constraint workspace_role_permissions_role_fk foreign key(role_id,workspace_id)
    references public.workspace_roles(id,workspace_id) on delete cascade,
  constraint workspace_role_permissions_key_shape check(permission_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

alter table public.profiles add column role_id uuid;
alter table public.profiles add constraint profiles_role_workspace_fk foreign key(role_id,workspace_id)
  references public.workspace_roles(id,workspace_id) on delete restrict;
create index profiles_workspace_role_idx on public.profiles(workspace_id,role_id);

create table public.profile_channel_account_access (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null,
  channel_account_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(profile_id,channel_account_id),
  constraint profile_channel_access_profile_fk foreign key(profile_id,workspace_id)
    references public.profiles(id,workspace_id) on delete cascade,
  constraint profile_channel_access_account_fk foreign key(channel_account_id,workspace_id)
    references public.channel_accounts(id,workspace_id) on delete cascade
);

alter table public.profiles add column all_channel_accounts boolean not null default false;

-- Existing operators retain full access. New users receive a conservative member role.
insert into public.workspace_roles(workspace_id,name,description,is_system)
select id,'Quản trị viên','Toàn quyền trong không gian làm việc',true from public.workspaces;
insert into public.workspace_roles(workspace_id,name,description,is_system)
select id,'Nhân viên','Quyền cơ bản; tài khoản kết nối phải được cấp riêng',true from public.workspaces;

insert into public.workspace_role_permissions(workspace_id,role_id,permission_key)
select r.workspace_id,r.id,p.permission_key
from public.workspace_roles r cross join (values
 ('dashboard.view'),('companies.view'),('companies.create'),('companies.update'),('companies.delete'),('companies.export'),('companies.import'),
 ('contacts.view'),('contacts.create'),('contacts.update'),('contacts.delete'),('contacts.export'),('contacts.import'),
 ('inbox.view'),('inbox.reply'),('inbox.update'),('campaigns.view'),('campaigns.create'),('campaigns.update'),('campaigns.delete'),('campaigns.launch'),('campaigns.export'),('campaigns.import'),
 ('tasks.view'),('tasks.create'),('tasks.update'),('tasks.delete'),('analytics.view'),
 ('settings.view'),('channels.view'),('channels.manage'),('roles.view'),('roles.manage')
) p(permission_key) where r.name='Quản trị viên';

insert into public.workspace_role_permissions(workspace_id,role_id,permission_key)
select r.workspace_id,r.id,p.permission_key
from public.workspace_roles r cross join (values
 ('dashboard.view'),('companies.view'),('contacts.view'),('inbox.view'),('inbox.reply'),('tasks.view')
) p(permission_key) where r.name='Nhân viên';

update public.profiles p set role_id=r.id,all_channel_accounts=true
from public.workspace_roles r where r.workspace_id=p.workspace_id and r.name='Quản trị viên';
alter table public.profiles alter column role_id set not null;

create function public.assign_default_workspace_role() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.role_id is null then
    select r.id into new.role_id from public.workspace_roles r
    where r.workspace_id=new.workspace_id and r.name='Nhân viên' limit 1;
  end if;
  new.all_channel_accounts:=coalesce(new.all_channel_accounts,false);
  return new;
end $$;
create trigger profiles_assign_default_workspace_role before insert on public.profiles
for each row execute function public.assign_default_workspace_role();

create function public.has_workspace_permission(p_permission_key text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join public.workspace_role_permissions rp
    on rp.role_id=p.role_id and rp.workspace_id=p.workspace_id
    where p.id=(select auth.uid()) and rp.permission_key=p_permission_key)
$$;
create function public.can_access_channel_account(p_channel_account_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and
    (p.all_channel_accounts or exists(select 1 from public.profile_channel_account_access a
      where a.profile_id=p.id and a.workspace_id=p.workspace_id and a.channel_account_id=p_channel_account_id)))
$$;
create function public.current_workspace_permissions() returns setof text
language sql stable security definer set search_path='' as $$
  select rp.permission_key from public.profiles p join public.workspace_role_permissions rp
    on rp.role_id=p.role_id and rp.workspace_id=p.workspace_id where p.id=(select auth.uid()) order by rp.permission_key
$$;
revoke all on function public.has_workspace_permission(text) from public;
revoke all on function public.can_access_channel_account(uuid) from public;
revoke all on function public.current_workspace_permissions() from public;
grant execute on function public.has_workspace_permission(text),public.can_access_channel_account(uuid),public.current_workspace_permissions() to authenticated;

alter table public.workspace_roles enable row level security;
alter table public.workspace_role_permissions enable row level security;
alter table public.profile_channel_account_access enable row level security;
create policy roles_read on public.workspace_roles for select to authenticated using(workspace_id=public.current_workspace_id() and public.has_workspace_permission('roles.view'));
create policy role_permissions_read on public.workspace_role_permissions for select to authenticated using(workspace_id=public.current_workspace_id() and public.has_workspace_permission('roles.view'));
create policy account_access_read on public.profile_channel_account_access for select to authenticated using(workspace_id=public.current_workspace_id() and (profile_id=auth.uid() or public.has_workspace_permission('roles.view')));
grant select on public.workspace_roles,public.workspace_role_permissions,public.profile_channel_account_access to authenticated;

-- Enforce per-account visibility at the canonical account boundary.
drop policy if exists channel_accounts_select_workspace on public.channel_accounts;
create policy channel_accounts_select_scoped on public.channel_accounts for select to authenticated
using(workspace_id=public.current_workspace_id() and public.can_access_channel_account(id));

commit;
