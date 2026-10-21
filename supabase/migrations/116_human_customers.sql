-- 116: Màn Khách hàng. A read-only copy of the customers (partners) in Human, by block ("khối"), refreshed
-- from Human by hand or every 6 hours. Who sees what: "Khách hàng · Xem" plus either "Xem tất cả" or being
-- the customer's Sale / AM (Human users are linked to HireX members in Cài đặt). Only the server writes.
begin;

create table public.human_partner_blocks (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  block_id integer not null check (block_id > 0),
  name text,
  enabled boolean not null default true,
  sort integer not null default 0,
  last_synced_at timestamptz,
  last_count integer,
  last_error text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, block_id)
);

create table public.human_partners (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  partner_id bigint not null,
  block_ids integer[] not null default '{}',
  name text,
  partner_type text,
  status text,
  address text,
  email text,
  phone text,
  website text,
  contact_name text,
  position text,
  sale_human_id text,
  sale_name text,
  am_human_id text,
  am_name text,
  am2_human_id text,
  am2_name text,
  note text,
  email_sent_at text,
  -- The record exactly as Human returned it (every field, also the ones not shown as columns).
  data jsonb not null default '{}'::jsonb,
  search_text text not null default '',
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  primary key (workspace_id, partner_id)
);
create index human_partners_list on public.human_partners(workspace_id, active, partner_id desc);
create index human_partners_blocks on public.human_partners using gin (block_ids);
create index human_partners_sale on public.human_partners(workspace_id, sale_human_id);
create index human_partners_am on public.human_partners(workspace_id, am_human_id);

-- Which HireX member a Human user (Sale / AM id) is.
create table public.human_user_links (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  human_user_id text not null,
  human_name text,
  profile_id uuid,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, human_user_id),
  constraint human_user_links_profile_fk foreign key (profile_id, workspace_id) references public.profiles(id, workspace_id) on delete set null (profile_id)
);
create index human_user_links_profile on public.human_user_links(workspace_id, profile_id);

create table public.human_partner_syncs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trigger text not null check (trigger in ('MANUAL', 'SCHEDULE')),
  started_by uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  rows integer,
  error text
);
create index human_partner_syncs_recent on public.human_partner_syncs(workspace_id, started_at desc);

alter table public.human_partner_blocks enable row level security;
alter table public.human_partners enable row level security;
alter table public.human_user_links enable row level security;
alter table public.human_partner_syncs enable row level security;

create policy human_partner_blocks_read on public.human_partner_blocks for select to authenticated
  using (workspace_id = public.current_workspace_id() and (select public.has_workspace_permission('customers.view')));
create policy human_partner_syncs_read on public.human_partner_syncs for select to authenticated
  using (workspace_id = public.current_workspace_id() and (select public.has_workspace_permission('customers.view')));
create policy human_user_links_read on public.human_user_links for select to authenticated
  using (workspace_id = public.current_workspace_id() and (select public.has_workspace_permission('customers.view')));
create policy human_partners_read on public.human_partners for select to authenticated
  using (workspace_id = public.current_workspace_id() and (select public.has_workspace_permission('customers.view')) and (
    (select public.has_workspace_permission('customers.view_all'))
    or exists (select 1 from public.human_user_links l where l.workspace_id = human_partners.workspace_id and l.profile_id = (select auth.uid())
      and l.human_user_id in (human_partners.sale_human_id, human_partners.am_human_id, human_partners.am2_human_id))));

revoke all on public.human_partner_blocks, public.human_partners, public.human_user_links, public.human_partner_syncs from anon, authenticated;
grant select on public.human_partner_blocks, public.human_partners, public.human_user_links, public.human_partner_syncs to authenticated;
grant all on public.human_partner_blocks, public.human_partners, public.human_user_links, public.human_partner_syncs to service_role;

-- The four blocks asked for first; administrators add or remove blocks in Cài đặt.
insert into public.human_partner_blocks(workspace_id, block_id, sort)
select w.id, b.block_id, b.sort from public.workspaces w cross join (values (36310, 1), (36309, 2), (36308, 3), (36307, 4)) as b(block_id, sort)
on conflict do nothing;

-- Administrators get the three new permissions.
insert into public.workspace_role_permissions(workspace_id, role_id, permission_key)
select role.workspace_id, role.id, p.key
from public.workspace_roles role cross join (values ('customers.view'), ('customers.view_all'), ('customers.manage')) as p(key)
where role.is_system = true and role.name = 'Quản trị viên'
on conflict (role_id, permission_key) do nothing;

-- Filter choices on the Khách hàng page (statuses, types, blocks) over the customers this member may see.
create or replace function public.human_partner_facets()
returns table(kind text, value text, total bigint)
language sql stable security invoker set search_path = public as $$
  select 'status', coalesce(p.status, ''), count(*) from public.human_partners p where p.workspace_id = public.current_workspace_id() and p.active group by 2
  union all
  select 'type', coalesce(p.partner_type, ''), count(*) from public.human_partners p where p.workspace_id = public.current_workspace_id() and p.active group by 2
  union all
  select 'block', b::text, count(*) from public.human_partners p cross join unnest(p.block_ids) b where p.workspace_id = public.current_workspace_id() and p.active group by 2
$$;
revoke all on function public.human_partner_facets() from public, anon;
grant execute on function public.human_partner_facets() to authenticated;

-- How many customers each Human Sale / AM has (Cài đặt → linking people).
create or replace function public.human_partner_owner_counts()
returns table(human_user_id text, total bigint)
language sql stable security invoker set search_path = public as $$
  select o.id, count(distinct p.partner_id) from public.human_partners p
  cross join lateral (values (p.sale_human_id), (p.am_human_id), (p.am2_human_id)) as o(id)
  where p.workspace_id = public.current_workspace_id() and p.active and o.id is not null
  group by o.id
$$;
revoke all on function public.human_partner_owner_counts() from public, anon;
grant execute on function public.human_partner_owner_counts() to authenticated;

-- Suối Nguồn: unread counts per account (filter panel) only look at unread conversations.
create index if not exists omnichannel_conversations_unread on public.omnichannel_conversations(workspace_id, channel_account_id) where unread_count > 0;

commit;
