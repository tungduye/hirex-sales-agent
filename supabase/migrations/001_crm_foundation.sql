-- HireX Sales Agent - Phase 1B.1 CRM Foundation
-- Preparation only. Review before applying to any Supabase project.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_name_not_blank check (btrim(name) <> '')
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  full_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_not_blank check (btrim(full_name) <> ''),
  constraint profiles_id_workspace_id_key unique (id, workspace_id)
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  name text not null,
  website text,
  industry text,
  country text,
  status text not null default 'PROSPECT',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_name_not_blank check (btrim(name) <> ''),
  constraint companies_website_not_blank check (website is null or btrim(website) <> ''),
  constraint companies_status_allowed check (status in ('ACTIVE', 'PROSPECT', 'INACTIVE')),
  constraint companies_id_workspace_id_key unique (id, workspace_id)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  company_id uuid,
  full_name text not null,
  job_title text,
  email text,
  phone text,
  country text,
  language text,
  source text,
  lead_status text not null default 'NEW',
  lead_score integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_full_name_not_blank check (btrim(full_name) <> ''),
  constraint contacts_email_not_blank check (email is null or btrim(email) <> ''),
  constraint contacts_phone_not_blank check (phone is null or btrim(phone) <> ''),
  constraint contacts_lead_status_allowed check (
    lead_status in (
      'NEW',
      'CONTACTED',
      'ENGAGED',
      'QUALIFIED',
      'OPPORTUNITY',
      'WON',
      'LOST',
      'DO_NOT_CONTACT'
    )
  ),
  constraint contacts_lead_score_range check (lead_score between 0 and 100),
  constraint contacts_id_workspace_id_key unique (id, workspace_id),
  constraint contacts_company_same_workspace_fk
    foreign key (company_id, workspace_id)
    references public.companies (id, workspace_id)
    on delete restrict
);

create table public.contact_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  contact_id uuid not null,
  channel_type text not null,
  channel_value text not null,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_channels_type_allowed check (
    channel_type in (
      'EMAIL',
      'PHONE',
      'FACEBOOK',
      'WHATSAPP',
      'ZALO',
      'VIBER',
      'LINKEDIN',
      'OTHER'
    )
  ),
  constraint contact_channels_value_not_blank check (btrim(channel_value) <> ''),
  constraint contact_channels_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint contact_channels_contact_same_workspace_fk
    foreign key (contact_id, workspace_id)
    references public.contacts (id, workspace_id)
    on delete cascade
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  contact_id uuid,
  company_id uuid,
  content text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_content_not_blank check (btrim(content) <> ''),
  constraint notes_has_exactly_one_parent check (
    (contact_id is not null and company_id is null)
    or (contact_id is null and company_id is not null)
  ),
  constraint notes_contact_same_workspace_fk
    foreign key (contact_id, workspace_id)
    references public.contacts (id, workspace_id)
    on delete cascade,
  constraint notes_company_same_workspace_fk
    foreign key (company_id, workspace_id)
    references public.companies (id, workspace_id)
    on delete cascade,
  constraint notes_creator_same_workspace_fk
    foreign key (created_by, workspace_id)
    references public.profiles (id, workspace_id)
    on delete restrict
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_not_blank check (btrim(action) <> ''),
  constraint audit_logs_entity_type_not_blank check (btrim(entity_type) <> ''),
  constraint audit_logs_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint audit_logs_actor_same_workspace_fk
    foreign key (actor_id, workspace_id)
    references public.profiles (id, workspace_id)
    on delete restrict
);

-- ---------------------------------------------------------------------------
-- Updated-at trigger
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

create trigger contacts_set_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

create trigger contact_channels_set_updated_at
before update on public.contact_channels
for each row execute function public.set_updated_at();

create trigger notes_set_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index profiles_workspace_id_idx
  on public.profiles (workspace_id);

create index companies_workspace_name_idx
  on public.companies (workspace_id, lower(name));
create index companies_workspace_status_idx
  on public.companies (workspace_id, status);
create index companies_workspace_industry_idx
  on public.companies (workspace_id, industry)
  where industry is not null;
create index companies_workspace_country_idx
  on public.companies (workspace_id, country)
  where country is not null;
create index companies_workspace_website_idx
  on public.companies (workspace_id, lower(website))
  where website is not null;
create index companies_workspace_created_at_idx
  on public.companies (workspace_id, created_at desc);

create index contacts_workspace_name_idx
  on public.contacts (workspace_id, lower(full_name));
create index contacts_workspace_company_id_idx
  on public.contacts (workspace_id, company_id)
  where company_id is not null;
create index contacts_workspace_lead_status_idx
  on public.contacts (workspace_id, lead_status);
create index contacts_workspace_lead_score_idx
  on public.contacts (workspace_id, lead_score desc);
create index contacts_workspace_email_idx
  on public.contacts (workspace_id, lower(email))
  where email is not null;
create index contacts_workspace_phone_idx
  on public.contacts (workspace_id, phone)
  where phone is not null;
create index contacts_workspace_country_idx
  on public.contacts (workspace_id, country)
  where country is not null;
create index contacts_workspace_source_idx
  on public.contacts (workspace_id, source)
  where source is not null;
create index contacts_workspace_created_at_idx
  on public.contacts (workspace_id, created_at desc);

create index contact_channels_workspace_contact_idx
  on public.contact_channels (workspace_id, contact_id);
create index contact_channels_workspace_type_idx
  on public.contact_channels (workspace_id, channel_type);
create index contact_channels_workspace_value_idx
  on public.contact_channels (workspace_id, lower(btrim(channel_value)));
create unique index contact_channels_identity_unique_idx
  on public.contact_channels (
    workspace_id,
    contact_id,
    channel_type,
    lower(btrim(channel_value))
  );
create unique index contact_channels_one_primary_per_type_idx
  on public.contact_channels (workspace_id, contact_id, channel_type)
  where is_primary;

create index notes_workspace_contact_created_at_idx
  on public.notes (workspace_id, contact_id, created_at desc)
  where contact_id is not null;
create index notes_workspace_company_created_at_idx
  on public.notes (workspace_id, company_id, created_at desc)
  where company_id is not null;
create index notes_workspace_created_by_idx
  on public.notes (workspace_id, created_by);

create index audit_logs_workspace_created_at_idx
  on public.audit_logs (workspace_id, created_at desc);
create index audit_logs_workspace_entity_idx
  on public.audit_logs (workspace_id, entity_type, entity_id, created_at desc);
create index audit_logs_workspace_actor_idx
  on public.audit_logs (workspace_id, actor_id, created_at desc)
  where actor_id is not null;

-- ---------------------------------------------------------------------------
-- Workspace-aware RLS helper
-- SECURITY DEFINER avoids recursive RLS while reading the caller's profile.
-- The function returns only the workspace assigned to auth.uid().
-- ---------------------------------------------------------------------------

create function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.workspace_id
  from public.profiles as p
  where p.id = (select auth.uid())
$$;

revoke all on function public.current_workspace_id() from public;
grant execute on function public.current_workspace_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- No public/anon policies. Workspace/profile provisioning is intentionally
-- excluded and must later use a reviewed, trusted onboarding transaction.
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_channels enable row level security;
alter table public.notes enable row level security;
alter table public.audit_logs enable row level security;

create policy workspaces_select_own
on public.workspaces
for select
to authenticated
using (id = (select public.current_workspace_id()));

create policy workspaces_update_own
on public.workspaces
for update
to authenticated
using (id = (select public.current_workspace_id()))
with check (id = (select public.current_workspace_id()));

create policy profiles_select_workspace
on public.profiles
for select
to authenticated
using (workspace_id = (select public.current_workspace_id()));

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (
  id = (select auth.uid())
  and workspace_id = (select public.current_workspace_id())
)
with check (
  id = (select auth.uid())
  and workspace_id = (select public.current_workspace_id())
);

create policy companies_select_workspace
on public.companies
for select
to authenticated
using (workspace_id = (select public.current_workspace_id()));
create policy companies_insert_workspace
on public.companies
for insert
to authenticated
with check (workspace_id = (select public.current_workspace_id()));
create policy companies_update_workspace
on public.companies
for update
to authenticated
using (workspace_id = (select public.current_workspace_id()))
with check (workspace_id = (select public.current_workspace_id()));
create policy companies_delete_workspace
on public.companies
for delete
to authenticated
using (workspace_id = (select public.current_workspace_id()));

create policy contacts_select_workspace
on public.contacts
for select
to authenticated
using (workspace_id = (select public.current_workspace_id()));
create policy contacts_insert_workspace
on public.contacts
for insert
to authenticated
with check (workspace_id = (select public.current_workspace_id()));
create policy contacts_update_workspace
on public.contacts
for update
to authenticated
using (workspace_id = (select public.current_workspace_id()))
with check (workspace_id = (select public.current_workspace_id()));
create policy contacts_delete_workspace
on public.contacts
for delete
to authenticated
using (workspace_id = (select public.current_workspace_id()));

create policy contact_channels_select_workspace
on public.contact_channels
for select
to authenticated
using (workspace_id = (select public.current_workspace_id()));
create policy contact_channels_insert_workspace
on public.contact_channels
for insert
to authenticated
with check (workspace_id = (select public.current_workspace_id()));
create policy contact_channels_update_workspace
on public.contact_channels
for update
to authenticated
using (workspace_id = (select public.current_workspace_id()))
with check (workspace_id = (select public.current_workspace_id()));
create policy contact_channels_delete_workspace
on public.contact_channels
for delete
to authenticated
using (workspace_id = (select public.current_workspace_id()));

create policy notes_select_workspace
on public.notes
for select
to authenticated
using (workspace_id = (select public.current_workspace_id()));
create policy notes_insert_workspace
on public.notes
for insert
to authenticated
with check (
  workspace_id = (select public.current_workspace_id())
  and created_by = (select auth.uid())
);
create policy notes_update_own
on public.notes
for update
to authenticated
using (
  workspace_id = (select public.current_workspace_id())
  and created_by = (select auth.uid())
)
with check (
  workspace_id = (select public.current_workspace_id())
  and created_by = (select auth.uid())
);
create policy notes_delete_own
on public.notes
for delete
to authenticated
using (
  workspace_id = (select public.current_workspace_id())
  and created_by = (select auth.uid())
);

create policy audit_logs_select_workspace
on public.audit_logs
for select
to authenticated
using (workspace_id = (select public.current_workspace_id()));
create policy audit_logs_insert_self
on public.audit_logs
for insert
to authenticated
with check (
  workspace_id = (select public.current_workspace_id())
  and actor_id = (select auth.uid())
);

commit;
