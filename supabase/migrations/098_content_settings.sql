-- 098: "Cài đặt Kho content" and readable content codes.
--  * content_options: the workspace's own list of Bộ phận, Định dạng, Ngôn ngữ and Phong cách, each with a
--    label, a short code (abbr) used in content codes, an order and an on/off switch. Định dạng also
--    carries its word range; Bộ phận a note for the AI. The built-in codes (REC, POST_LONG, VI…) keep
--    working without a row; a row overrides their label/abbr or adds a new one.
--  * content_categories ("Phân loại") get an abbr and a note for the AI.
--  * Department/format/language columns accept any built-in code or one listed in content_options
--    (checked by trigger), instead of a fixed list.
--  * New content and templates get a readable code, assigned by the database:
--      content  261019_REC_DCT_GT_VI_01  (YYMMDD Vietnam time _ bộ phận _ định dạng _ loại _ ngôn ngữ _ n)
--      template M_REC_DCT_GT_VI_03
--    Existing CT-000123 / MAU-0001 codes stay as they are.
begin;

create table public.content_options (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null,
  code text not null,
  label text not null,
  abbr text,
  sort integer not null default 0,
  active boolean not null default true,
  word_min integer,
  word_max integer,
  guide text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_options_kind_allowed check (kind in ('DEPARTMENT','FORMAT','LANGUAGE','STYLE')),
  constraint content_options_code_shape check (code ~ '^[A-Z][A-Z0-9_]{0,19}$'),
  constraint content_options_label_valid check (btrim(label) <> '' and length(label) <= 60),
  constraint content_options_abbr_shape check (abbr is null or abbr ~ '^[A-Z0-9]{1,8}$'),
  constraint content_options_words_valid check ((word_min is null and word_max is null) or (word_min between 1 and 2000 and word_max between word_min and 3000)),
  constraint content_options_guide_limit check (guide is null or length(guide) <= 1000),
  constraint content_options_code_key unique (workspace_id, kind, code)
);
create unique index content_options_abbr_key on public.content_options(workspace_id, kind, abbr) where abbr is not null;
create trigger content_options_set_updated_at before update on public.content_options for each row execute function public.set_updated_at();

alter table public.content_options enable row level security;
create policy content_options_select on public.content_options for select to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.view'));
create policy content_options_insert on public.content_options for insert to authenticated
with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.templates'));
create policy content_options_update on public.content_options for update to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.templates'))
with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.templates'));
revoke all on public.content_options from anon, authenticated;
grant select on public.content_options to authenticated;
grant insert (workspace_id, kind, code, label, abbr, sort, active, word_min, word_max, guide) on public.content_options to authenticated;
grant update (label, abbr, sort, active, word_min, word_max, guide) on public.content_options to authenticated;
grant all on public.content_options to service_role;

-- Built-in options: what the app shipped with. Kept here so codes and checks work with no rows.
create function public.content_builtin_abbr(p_kind text, p_code text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'DEPARTMENT' then case p_code when 'REC' then 'REC' when 'HR' then 'HR' when 'SALE' then 'SALE'
      when 'MEDIA' then 'MEDIA' when 'NOTICE' then 'TB' when 'CTV' then 'CTV' end
    when 'FORMAT' then case p_code when 'EMAIL' then 'MAIL' when 'POST_LONG' then 'DCT' when 'POST_MEDIUM' then 'DTB'
      when 'POST_SHORT' then 'DV' when 'COMMENT' then 'CMT' end
    when 'LANGUAGE' then case p_code when 'VI' then 'VI' when 'EN' then 'EN' when 'JA' then 'JA'
      when 'VI_EN' then 'VIEN' when 'VI_JA' then 'VIJA' when 'EN_JA' then 'ENJA' end
  end
$$;

/** A department/format/language code the workspace may use: built in, or listed in its options. */
create function public.content_option_known(p_workspace uuid, p_kind text, p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_code is not null and (public.content_builtin_abbr(p_kind, p_code) is not null
    or exists (select 1 from public.content_options o where o.workspace_id = p_workspace and o.kind = p_kind and o.code = p_code))
$$;

create function public.content_option_abbr(p_workspace uuid, p_kind text, p_code text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select o.abbr from public.content_options o where o.workspace_id = p_workspace and o.kind = p_kind and o.code = p_code),
    public.content_builtin_abbr(p_kind, p_code),
    left(regexp_replace(coalesce(p_code, 'X'), '[^A-Z0-9]', '', 'g'), 8))
$$;
revoke all on function public.content_option_known(uuid, text, text) from public;
grant execute on function public.content_option_known(uuid, text, text) to authenticated, service_role;
revoke all on function public.content_option_abbr(uuid, text, text) from public;

-- Fixed lists become "known code" checks ---------------------------------------
alter table public.content_items drop constraint content_items_department_allowed, drop constraint content_items_format_allowed, drop constraint content_items_language_allowed;
alter table public.content_batches drop constraint content_batches_department_allowed, drop constraint content_batches_format_allowed, drop constraint content_batches_language_allowed;
alter table public.content_templates drop constraint content_templates_department_allowed, drop constraint content_templates_format_allowed, drop constraint content_templates_language_allowed;
alter table public.content_categories drop constraint content_categories_department_allowed;

create function public.content_check_options() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_department text := to_jsonb(new) ->> 'department';
  v_format text := coalesce(to_jsonb(new) ->> 'content_format', 'POST_LONG');
  v_language text := coalesce(to_jsonb(new) ->> 'content_language', to_jsonb(new) ->> 'language', 'VI');
begin
  if not public.content_option_known(new.workspace_id, 'DEPARTMENT', v_department) then
    raise exception 'unknown department %', v_department using errcode = '23514';
  end if;
  if tg_table_name <> 'content_categories' then
    if not public.content_option_known(new.workspace_id, 'FORMAT', v_format) then
      raise exception 'unknown format %', v_format using errcode = '23514';
    end if;
    if not public.content_option_known(new.workspace_id, 'LANGUAGE', v_language) then
      raise exception 'unknown language %', v_language using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger content_items_check_options before insert or update of department, content_format, content_language on public.content_items
  for each row execute function public.content_check_options();
create trigger content_batches_check_options before insert or update of department, content_format, content_language on public.content_batches
  for each row execute function public.content_check_options();
create trigger content_templates_check_options before insert or update of department, content_format, language on public.content_templates
  for each row execute function public.content_check_options();
create trigger content_categories_check_options before insert or update of department on public.content_categories
  for each row execute function public.content_check_options();

-- Categories: abbr + note for the AI ---------------------------------------------
alter table public.content_categories add column abbr text, add column guide text,
  add constraint content_categories_abbr_shape check (abbr is null or abbr ~ '^[A-Z0-9]{1,8}$'),
  add constraint content_categories_guide_limit check (guide is null or length(guide) <= 1000);
create unique index content_categories_abbr_key on public.content_categories(workspace_id, department, abbr) where abbr is not null;
grant insert (abbr, guide) on public.content_categories to authenticated;
grant update (abbr, guide) on public.content_categories to authenticated;

-- Initials of the name, without Vietnamese marks ("Giới thiệu" → GT, "Dạng share" → DS).
create function public.content_initials(p_name text) returns text
language sql immutable set search_path = '' as $$
  select left(upper(string_agg(left(word, 1), '')), 8) from regexp_split_to_table(
    translate(lower(coalesce(p_name, '')),
      'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ',
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'),
    '[^a-z0-9]+') as word where word <> ''
$$;
update public.content_categories c set abbr = x.abbr from (
  select id, case when row_number() over (partition by workspace_id, department, public.content_initials(name) order by sort, created_at) = 1
    then public.content_initials(name)
    else left(public.content_initials(name), 6) || row_number() over (partition by workspace_id, department, public.content_initials(name) order by sort, created_at) end as abbr
  from public.content_categories) x
where c.id = x.id and x.abbr <> '';

-- Readable codes -------------------------------------------------------------------
create table public.content_code_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  prefix text not null,
  last_value integer not null,
  primary key (workspace_id, prefix)
);
alter table public.content_code_counters enable row level security;
revoke all on public.content_code_counters from anon, authenticated;
grant all on public.content_code_counters to service_role;

create function public.content_next_code(p_workspace uuid, p_prefix text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_next integer;
begin
  insert into public.content_code_counters as c(workspace_id, prefix, last_value) values (p_workspace, p_prefix, 1)
  on conflict (workspace_id, prefix) do update set last_value = c.last_value + 1
  returning last_value into v_next;
  return p_prefix || '_' || lpad(v_next::text, 2, '0');
end $$;
revoke all on function public.content_next_code(uuid, text) from public;

create function public.content_code_parts(p_workspace uuid, p_department text, p_format text, p_category uuid, p_language text) returns text
language sql stable security definer set search_path = '' as $$
  select public.content_option_abbr(p_workspace, 'DEPARTMENT', p_department)
    || '_' || public.content_option_abbr(p_workspace, 'FORMAT', coalesce(p_format, 'POST_LONG'))
    || '_' || coalesce((select c.abbr from public.content_categories c where c.id = p_category and c.workspace_id = p_workspace), 'CHUNG')
    || '_' || public.content_option_abbr(p_workspace, 'LANGUAGE', coalesce(p_language, 'VI'))
$$;
revoke all on function public.content_code_parts(uuid, text, text, uuid, text) from public;

create function public.content_items_assign_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.code := public.content_next_code(new.workspace_id,
    to_char(coalesce(new.created_at, now()) at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD') || '_'
    || public.content_code_parts(new.workspace_id, new.department, new.content_format, new.category_id, new.content_language));
  return new;
end $$;
create trigger content_items_assign_code before insert on public.content_items for each row execute function public.content_items_assign_code();

create function public.content_templates_assign_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.code := public.content_next_code(new.workspace_id,
    'M_' || public.content_code_parts(new.workspace_id, new.department, new.content_format, new.category_id, new.language));
  return new;
end $$;
create trigger content_templates_assign_code before insert on public.content_templates for each row execute function public.content_templates_assign_code();

-- Codes are unique inside a workspace (the counter is per workspace).
alter table public.content_items drop constraint content_items_code_key, add constraint content_items_code_key unique (workspace_id, code);

-- Seed every workspace with the built-in lists so Cài đặt shows them and they can be edited.
insert into public.content_options(workspace_id, kind, code, label, abbr, sort, word_min, word_max, guide)
select w.id, o.kind, o.code, o.label, o.abbr, o.sort, o.word_min, o.word_max, null
from public.workspaces w cross join (values
  ('DEPARTMENT','REC','Tuyển dự án','REC',1,null::int,null::int),
  ('DEPARTMENT','SALE','Sale','SALE',2,null,null),
  ('DEPARTMENT','HR','Tuyển nội bộ','HR',3,null,null),
  ('DEPARTMENT','MEDIA','Truyền thông','MEDIA',4,null,null),
  ('DEPARTMENT','NOTICE','Thông báo','TB',5,null,null),
  ('DEPARTMENT','CTV','CTV','CTV',6,null,null),
  ('FORMAT','EMAIL','Mail','MAIL',1,120,200),
  ('FORMAT','POST_LONG','Đăng chi tiết','DCT',2,180,300),
  ('FORMAT','POST_MEDIUM','Đăng trung bình','DTB',3,80,120),
  ('FORMAT','POST_SHORT','Đăng vắn','DV',4,25,50),
  ('FORMAT','COMMENT','Comment','CMT',5,10,30),
  ('LANGUAGE','VI','Tiếng Việt','VI',1,null,null),
  ('LANGUAGE','EN','Tiếng Anh','EN',2,null,null),
  ('LANGUAGE','JA','Tiếng Nhật','JA',3,null,null),
  ('LANGUAGE','VI_EN','Song ngữ Việt – Anh','VIEN',4,null,null),
  ('LANGUAGE','VI_JA','Song ngữ Việt – Nhật','VIJA',5,null,null),
  ('LANGUAGE','EN_JA','Song ngữ Nhật – Anh','ENJA',6,null,null),
  ('STYLE','PROFESSIONAL','Chuyên nghiệp',null,1,null,null),
  ('STYLE','FRIENDLY','Thân thiện, gần gũi',null,2,null,null),
  ('STYLE','YOUTHFUL','Trẻ trung, năng động',null,3,null,null),
  ('STYLE','INSPIRING','Truyền cảm hứng',null,4,null,null),
  ('STYLE','CONCISE','Ngắn gọn, súc tích',null,5,null,null),
  ('STYLE','STORYTELLING','Kể chuyện',null,6,null,null)
) o(kind, code, label, abbr, sort, word_min, word_max)
on conflict do nothing;

commit;
