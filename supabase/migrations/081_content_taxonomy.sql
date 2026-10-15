-- 081: One taxonomy for "Kho mẫu" (content_templates) and the content library (content_items):
--  * Định dạng: EMAIL (Mail), POST_LONG (Đăng chi tiết), POST_MEDIUM (Đăng trung bình),
--    POST_SHORT (Đăng vắn), COMMENT. Old codes: POST/STORY → POST_LONG, ESSAY_100 → POST_MEDIUM,
--    SUMMARY_50 → POST_SHORT. Templates get a format too (guessed from length, editable).
--  * Bộ phận: REC (Tuyển dự án), HR (Tuyển nội bộ), SALE, CTV, plus MEDIA (Truyền thông) and
--    NOTICE (Thông báo).
--  * Ngôn ngữ: JA (tiếng Nhật) is allowed for generated content as well.
--  * Phân loại: content_categories, a per-department list managed by people with
--    content.templates (seeded: Sale → Giới thiệu, Dạng share). A category always belongs to the
--    row's department (composite foreign key).
begin;

-- Departments --------------------------------------------------------------
alter table public.content_templates drop constraint content_templates_department_allowed,
  add constraint content_templates_department_allowed check (department in ('REC','HR','SALE','CTV','MEDIA','NOTICE'));
alter table public.content_items drop constraint content_items_department_allowed,
  add constraint content_items_department_allowed check (department in ('REC','HR','SALE','CTV','MEDIA','NOTICE'));
alter table public.content_batches drop constraint content_batches_department_allowed,
  add constraint content_batches_department_allowed check (department in ('REC','HR','SALE','CTV','MEDIA','NOTICE'));

-- Formats ------------------------------------------------------------------
alter table public.content_items drop constraint content_items_format_allowed;
alter table public.content_batches drop constraint content_batches_format_allowed;
update public.content_items set content_format = case content_format
  when 'POST' then 'POST_LONG' when 'STORY' then 'POST_LONG' when 'ESSAY_100' then 'POST_MEDIUM' when 'SUMMARY_50' then 'POST_SHORT' else content_format end;
update public.content_batches set content_format = case content_format
  when 'POST' then 'POST_LONG' when 'STORY' then 'POST_LONG' when 'ESSAY_100' then 'POST_MEDIUM' when 'SUMMARY_50' then 'POST_SHORT' else content_format end;
alter table public.content_items add constraint content_items_format_allowed check (content_format in ('EMAIL','POST_LONG','POST_MEDIUM','POST_SHORT','COMMENT'));
alter table public.content_batches add constraint content_batches_format_allowed check (content_format in ('EMAIL','POST_LONG','POST_MEDIUM','POST_SHORT','COMMENT'));

alter table public.content_templates add column content_format text not null default 'POST_LONG',
  add constraint content_templates_format_allowed check (content_format in ('EMAIL','POST_LONG','POST_MEDIUM','POST_SHORT','COMMENT'));
update public.content_templates set content_format = case
  when coalesce(content_type, '') ilike '%mail%' then 'EMAIL'
  when coalesce(array_length(regexp_split_to_array(btrim(body), '\s+'), 1), 0) <= 60 then 'POST_SHORT'
  when coalesce(array_length(regexp_split_to_array(btrim(body), '\s+'), 1), 0) <= 160 then 'POST_MEDIUM'
  else 'POST_LONG' end;

-- Languages ----------------------------------------------------------------
alter table public.content_items drop constraint content_items_language_allowed,
  add constraint content_items_language_allowed check (content_language in ('VI','EN','JA','VI_EN','VI_JA','EN_JA'));
alter table public.content_batches drop constraint content_batches_language_allowed,
  add constraint content_batches_language_allowed check (content_language in ('VI','EN','JA','VI_EN','VI_JA','EN_JA'));

-- Categories ("Phân loại") ---------------------------------------------------
create table public.content_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  department text not null,
  name text not null,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  constraint content_categories_department_allowed check (department in ('REC','HR','SALE','CTV','MEDIA','NOTICE')),
  constraint content_categories_name_valid check (btrim(name) <> '' and length(name) <= 60),
  constraint content_categories_id_workspace_key unique (id, workspace_id),
  constraint content_categories_id_workspace_department_key unique (id, workspace_id, department)
);
create unique index content_categories_name_key on public.content_categories(workspace_id, department, lower(btrim(name)));

alter table public.content_categories enable row level security;
create policy content_categories_select on public.content_categories for select to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.view'));
create policy content_categories_insert on public.content_categories for insert to authenticated
with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.templates'));
create policy content_categories_update on public.content_categories for update to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.templates'))
with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.templates'));
create policy content_categories_delete on public.content_categories for delete to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.templates'));
revoke all on public.content_categories from anon, authenticated;
grant select, delete on public.content_categories to authenticated;
grant insert (workspace_id, department, name, active, sort) on public.content_categories to authenticated;
grant update (name, active, sort) on public.content_categories to authenticated;
grant all on public.content_categories to service_role;

insert into public.content_categories(workspace_id, department, name, sort)
select w.id, 'SALE', c.name, c.sort from public.workspaces w
cross join (values ('Giới thiệu', 1), ('Dạng share', 2)) c(name, sort)
on conflict do nothing;

-- Category on templates, briefs and content (always of the row's own department).
alter table public.content_templates add column category_id uuid,
  add constraint content_templates_category_fk foreign key (category_id, workspace_id, department)
    references public.content_categories(id, workspace_id, department) on delete set null (category_id);
alter table public.content_batches add column category_id uuid,
  add constraint content_batches_category_fk foreign key (category_id, workspace_id, department)
    references public.content_categories(id, workspace_id, department) on delete set null (category_id);
alter table public.content_items add column category_id uuid,
  add constraint content_items_category_fk foreign key (category_id, workspace_id, department)
    references public.content_categories(id, workspace_id, department) on delete set null (category_id);
create index content_items_taxonomy on public.content_items(workspace_id, content_format, department, category_id, content_language);
create index content_templates_category on public.content_templates(category_id) where category_id is not null;

grant insert (content_format, category_id) on public.content_templates to authenticated;
grant update (content_format, category_id) on public.content_templates to authenticated;
grant insert (category_id) on public.content_batches to authenticated;
grant insert (category_id) on public.content_items to authenticated;

commit;
