-- 123: Tài liệu HireX: documents members ask Soda to keep ("lưu tài liệu anh vừa nhắn vào mục Tài liệu").
-- They sit next to the library copied from Human (folder "Tài liệu HireX" › <thư mục>), are never touched by the
-- Human update, and are read by the same pages and Trợ lý tools (Tài liệu · Xem). Saving needs the new
-- permission "Tài liệu · Thêm" (documents.create), given to administrators here. The original file, when the
-- member sent one, is kept privately in storage. Written by the server only.
begin;

create table public.hirex_documents (
  id bigint generated always as identity (start with 900000001) primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  folder text not null default 'Soda lưu',
  content_html text not null,
  content_chars integer not null default 0,
  source text not null default 'WEB',
  attachment_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hirex_documents_title_valid check (btrim(title) <> '' and char_length(title) <= 200),
  constraint hirex_documents_folder_valid check (btrim(folder) <> '' and char_length(folder) <= 120 and folder !~ '[/\\]'),
  constraint hirex_documents_content_size check (char_length(content_html) between 1 and 2000000),
  constraint hirex_documents_source_allowed check (source in ('WEB', 'ZALO')),
  constraint hirex_documents_creator_fk foreign key (created_by, workspace_id) references public.profiles(id, workspace_id) on delete set null (created_by),
  constraint hirex_documents_attachment_fk foreign key (attachment_id, workspace_id) references public.channel_attachments(id, workspace_id) on delete set null (attachment_id)
);
create index hirex_documents_workspace on public.hirex_documents(workspace_id, folder, created_at desc);
create trigger hirex_documents_updated_at before update on public.hirex_documents for each row execute function public.set_updated_at();
alter table public.hirex_documents enable row level security;
revoke all on public.hirex_documents from anon, authenticated;
grant all on public.hirex_documents to service_role;

insert into public.workspace_role_permissions(workspace_id, role_id, permission_key)
select role.workspace_id, role.id, 'documents.create'
from public.workspace_roles role
where role.is_system = true and role.name = 'Quản trị viên'
on conflict (role_id, permission_key) do nothing;

alter table public.assistant_actions drop constraint assistant_actions_kind_allowed,
  add constraint assistant_actions_kind_allowed check (kind in (
    'CREATE_TASK','SET_LEAD_STATUS','CAMPAIGN_CONTROL','CREATE_CONTENT','AI_RECRUITER_SAFE_STOP','SEND_REPLY','CREATE_RULE',
    'CREATE_CONTACT','UPDATE_CONTACT','ADD_NOTE','CREATE_COMPANY','UPDATE_COMPANY','UPDATE_TASK',
    'CREATE_EMAIL_CAMPAIGNS','CREATE_EVENT','CANCEL_EVENT','SET_REMINDER','CREATE_BROADCAST','BULK_INBOX','SAVE_DOCUMENT'));

commit;
