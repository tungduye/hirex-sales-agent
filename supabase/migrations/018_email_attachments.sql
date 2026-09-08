begin;

alter table public.email_campaign_events drop constraint email_campaign_events_event_type_check;
alter table public.email_campaign_events add constraint email_campaign_events_event_type_check check(event_type in ('CAMPAIGN_CREATED','AUDIENCE_IMPORTED','CAMPAIGN_SCHEDULED','CAMPAIGN_STARTED','CAMPAIGN_PAUSED','CAMPAIGN_RESUMED','CAMPAIGN_CANCELLED','CAMPAIGN_COMPLETED','RECIPIENT_CLAIMED','RECIPIENT_SENT','RECIPIENT_FAILED','RECIPIENT_SUPPRESSED','RECIPIENT_DELIVERY_UNKNOWN','SEQUENCE_INITIALIZED','STEP_SENT','STEP_FAILED','RECIPIENT_REPLIED','RECIPIENT_HARD_BOUNCED','RECIPIENT_UNSUBSCRIBED','RECIPIENT_COMPLETED','ATTACHMENT_ADDED','ATTACHMENT_REMOVED'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-attachments','email-attachments',false,10485760,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain','text/csv','image/png','image/jpeg'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  storage_bucket text not null default 'email-attachments' check (storage_bucket='email-attachments'),
  storage_path text not null,
  original_filename text not null check (length(original_filename) between 1 and 255 and original_filename !~ '[[:cntrl:]]'),
  safe_filename text not null check (safe_filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$' and safe_filename !~ '\.\.'),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid not null,
  lifecycle_status text not null default 'DRAFT_UNUSED' check (lifecycle_status in ('DRAFT_UNUSED','ACTIVE','REFERENCED_SENT','SOFT_DELETED')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint email_attachments_uploader_workspace_fk foreign key(uploaded_by,workspace_id) references public.profiles(id,workspace_id) on delete restrict,
  constraint email_attachments_id_workspace_key unique(id,workspace_id),
  constraint email_attachments_storage_path_key unique(storage_bucket,storage_path),
  constraint email_attachments_deleted_shape check ((lifecycle_status='SOFT_DELETED')=(deleted_at is not null))
);

create table public.email_campaign_step_attachments (
  workspace_id uuid not null,
  campaign_id uuid not null,
  step_id uuid not null,
  attachment_id uuid not null,
  sort_order smallint not null check (sort_order between 0 and 9),
  created_at timestamptz not null default now(),
  primary key(step_id,attachment_id),
  constraint email_campaign_step_attachments_order_key unique(step_id,sort_order) deferrable initially immediate,
  foreign key(campaign_id,workspace_id) references public.email_campaigns(id,workspace_id) on delete cascade,
  foreign key(step_id,workspace_id) references public.email_campaign_steps(id,workspace_id) on delete cascade,
  foreign key(attachment_id,workspace_id) references public.email_attachments(id,workspace_id) on delete restrict
);

create index email_attachments_workspace_created_idx on public.email_attachments(workspace_id,created_at desc);
create index email_campaign_step_attachments_campaign_idx on public.email_campaign_step_attachments(workspace_id,campaign_id,step_id,sort_order);

create function public.guard_campaign_step_attachment_mutation() returns trigger language plpgsql security definer set search_path='' as $$
declare v_campaign_id uuid; v_workspace_id uuid; v_status text;
begin
  v_campaign_id:=coalesce(new.campaign_id,old.campaign_id); v_workspace_id:=coalesce(new.workspace_id,old.workspace_id);
  select status into v_status from public.email_campaigns where id=v_campaign_id and workspace_id=v_workspace_id for update;
  if v_status is distinct from 'DRAFT' then raise exception 'Campaign attachments are immutable outside DRAFT'; end if;
  if tg_op<>'DELETE' and not exists(select 1 from public.email_attachments a where a.id=new.attachment_id and a.workspace_id=new.workspace_id and a.deleted_at is null) then raise exception 'Attachment unavailable'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger email_campaign_step_attachments_guard before insert or update or delete on public.email_campaign_step_attachments for each row execute function public.guard_campaign_step_attachment_mutation();

alter table public.email_attachments enable row level security;
alter table public.email_campaign_step_attachments enable row level security;
create policy email_attachments_select_workspace on public.email_attachments for select to authenticated using(workspace_id=public.current_workspace_id() and deleted_at is null);
create policy email_campaign_step_attachments_select_workspace on public.email_campaign_step_attachments for select to authenticated using(workspace_id=public.current_workspace_id());
revoke all on public.email_attachments,public.email_campaign_step_attachments from public,anon,authenticated;
grant select(id,workspace_id,storage_bucket,storage_path,original_filename,safe_filename,mime_type,size_bytes,sha256,lifecycle_status,created_at) on public.email_attachments to authenticated;
grant select on public.email_campaign_step_attachments to authenticated;
comment on table public.email_attachments is 'Private immutable attachment metadata; object bytes live in private Supabase Storage.';
commit;
