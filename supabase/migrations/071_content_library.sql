-- 071: Content library ("Kho content").
-- A batch is one brief filled in the "Tạo content" popup; each generated piece is a content item
-- with its own permanent code (CT-000001, CT-000002, ...). Duplicate checking (no item may overlap
-- an existing one by more than 50%) runs in the application before insert; max_similarity records
-- the measured value for every saved item.
begin;

create sequence if not exists public.content_item_code_seq;

create table public.content_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null,
  job_title text not null,
  position text,
  location text,
  languages_required text,
  tech_skills text,
  salary text,
  highlights text,
  style text not null,
  style_note text,
  sample_content text,
  content_language text not null,
  content_format text not null,
  department text not null,
  quantity integer not null,
  model text,
  status text not null default 'PENDING',
  saved_count integer not null default 0,
  rejected_count integer not null default 0,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint content_batches_id_workspace_key unique (id, workspace_id),
  constraint content_batches_creator_fk foreign key (created_by, workspace_id) references public.profiles(id, workspace_id) on delete restrict,
  constraint content_batches_job_title_not_blank check (btrim(job_title) <> '' and length(job_title) <= 200),
  constraint content_batches_language_allowed check (content_language in ('VI','EN','VI_EN','VI_JA','EN_JA')),
  constraint content_batches_format_allowed check (content_format in ('EMAIL','ESSAY_100','SUMMARY_50','STORY')),
  constraint content_batches_department_not_blank check (btrim(department) <> '' and length(department) <= 100),
  constraint content_batches_style_not_blank check (btrim(style) <> '' and length(style) <= 100),
  constraint content_batches_quantity_range check (quantity between 1 and 10),
  constraint content_batches_status_allowed check (status in ('PENDING','COMPLETED','PARTIAL','FAILED')),
  constraint content_batches_counts_valid check (saved_count >= 0 and rejected_count >= 0 and saved_count + rejected_count <= quantity),
  constraint content_batches_text_limits check (
    coalesce(length(position),0) <= 200 and coalesce(length(location),0) <= 200 and coalesce(length(languages_required),0) <= 200
    and coalesce(length(tech_skills),0) <= 1000 and coalesce(length(salary),0) <= 200 and coalesce(length(highlights),0) <= 2000
    and coalesce(length(style_note),0) <= 500 and coalesce(length(sample_content),0) <= 6000
  )
);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  batch_id uuid not null,
  code text not null default ('CT-' || lpad(nextval('public.content_item_code_seq')::text, 6, '0')),
  title text not null,
  body text not null,
  job_title text not null,
  content_language text not null,
  content_format text not null,
  department text not null,
  style text not null,
  max_similarity numeric(5,4) not null default 0,
  most_similar_item_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint content_items_code_key unique (code),
  constraint content_items_id_workspace_key unique (id, workspace_id),
  constraint content_items_batch_fk foreign key (batch_id, workspace_id) references public.content_batches(id, workspace_id) on delete cascade,
  constraint content_items_creator_fk foreign key (created_by, workspace_id) references public.profiles(id, workspace_id) on delete restrict,
  constraint content_items_similar_fk foreign key (most_similar_item_id, workspace_id) references public.content_items(id, workspace_id) on delete set null (most_similar_item_id),
  constraint content_items_text_not_blank check (btrim(title) <> '' and btrim(body) <> '' and length(title) <= 300 and length(body) <= 20000),
  constraint content_items_language_allowed check (content_language in ('VI','EN','VI_EN','VI_JA','EN_JA')),
  constraint content_items_format_allowed check (content_format in ('EMAIL','ESSAY_100','SUMMARY_50','STORY')),
  -- The 50% rule, recorded at the database boundary as well.
  constraint content_items_similarity_limit check (max_similarity >= 0 and max_similarity <= 0.5)
);

create index content_items_workspace_created on public.content_items(workspace_id, created_at desc, id desc);
create index content_items_batch on public.content_items(batch_id);
create index content_batches_workspace_created on public.content_batches(workspace_id, created_at desc);

alter table public.content_batches enable row level security;
alter table public.content_items enable row level security;

create policy content_batches_select on public.content_batches for select to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.view'));
create policy content_batches_insert on public.content_batches for insert to authenticated
with check (workspace_id = public.current_workspace_id() and created_by = auth.uid() and public.has_workspace_permission('content.create'));
create policy content_batches_update on public.content_batches for update to authenticated
using (workspace_id = public.current_workspace_id() and created_by = auth.uid() and public.has_workspace_permission('content.create'))
with check (workspace_id = public.current_workspace_id() and created_by = auth.uid() and public.has_workspace_permission('content.create'));

create policy content_items_select on public.content_items for select to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.view'));
create policy content_items_insert on public.content_items for insert to authenticated
with check (workspace_id = public.current_workspace_id() and created_by = auth.uid() and public.has_workspace_permission('content.create'));
create policy content_items_delete on public.content_items for delete to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.delete'));

-- Column grants: codes and timestamps are assigned by the database only, and a batch brief
-- cannot be rewritten after it is created (only its outcome is recorded).
revoke all on public.content_batches, public.content_items from anon, authenticated;
grant select, delete on public.content_items to authenticated;
grant insert (id, workspace_id, batch_id, title, body, job_title, content_language, content_format, department, style, max_similarity, most_similar_item_id, created_by)
  on public.content_items to authenticated;
grant select on public.content_batches to authenticated;
grant insert (id, workspace_id, created_by, job_title, position, location, languages_required, tech_skills, salary, highlights, style, style_note, sample_content, content_language, content_format, department, quantity, model)
  on public.content_batches to authenticated;
grant update (status, saved_count, rejected_count, error_code, completed_at) on public.content_batches to authenticated;
grant usage on sequence public.content_item_code_seq to authenticated;
grant all on public.content_batches, public.content_items to service_role;

-- Administrators get the new permissions; other roles are granted in Settings > Roles.
insert into public.workspace_role_permissions(workspace_id, role_id, permission_key)
select role.workspace_id, role.id, permission.permission_key
from public.workspace_roles role
cross join (values ('content.view'), ('content.create'), ('content.delete')) permission(permission_key)
where role.is_system = true and role.name = 'Quản trị viên'
on conflict (role_id, permission_key) do nothing;

commit;
