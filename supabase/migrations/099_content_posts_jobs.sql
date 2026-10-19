-- 099: Kho content, đợt 4.
--  * A brief and its content can point at the job of Bảng Job they were made for (job_id), so content
--    of a closed job is flagged "Job đã đóng".
--  * content_item_posts: where a content was posted ("Đã đăng ở…": nhóm/kênh), so the team does not
--    post the same piece twice in one group.
--  * content_items.copy_count: how often it was copied; often-used content is suggested as a template.
begin;

alter table public.content_batches add column job_id uuid,
  add constraint content_batches_job_fk foreign key (job_id, workspace_id) references public.recruitment_jobs(id, workspace_id) on delete set null (job_id);
alter table public.content_items add column job_id uuid, add column copy_count integer not null default 0,
  add constraint content_items_job_fk foreign key (job_id, workspace_id) references public.recruitment_jobs(id, workspace_id) on delete set null (job_id),
  add constraint content_items_copy_count_valid check (copy_count >= 0);
create index content_items_job on public.content_items(workspace_id, job_id) where job_id is not null;
grant insert (job_id) on public.content_batches to authenticated;

create table public.content_item_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_item_id uuid not null,
  channel text not null,
  place text not null,
  posted_by uuid,
  posted_at timestamptz not null default now(),
  constraint content_item_posts_item_fk foreign key (content_item_id, workspace_id) references public.content_items(id, workspace_id) on delete cascade,
  constraint content_item_posts_poster_fk foreign key (posted_by, workspace_id) references public.profiles(id, workspace_id) on delete set null (posted_by),
  constraint content_item_posts_channel_allowed check (channel in ('FACEBOOK_GROUP','FACEBOOK_PAGE','FACEBOOK_PROFILE','ZALO_GROUP','LINKEDIN','OTHER')),
  constraint content_item_posts_place_valid check (btrim(place) <> '' and length(place) <= 200)
);
create index content_item_posts_item on public.content_item_posts(workspace_id, content_item_id, posted_at desc);
create index content_item_posts_place on public.content_item_posts(workspace_id, lower(btrim(place)));

alter table public.content_item_posts enable row level security;
create policy content_item_posts_select on public.content_item_posts for select to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.view'));
create policy content_item_posts_insert on public.content_item_posts for insert to authenticated
with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.view') and posted_by = auth.uid());
create policy content_item_posts_delete on public.content_item_posts for delete to authenticated
using (workspace_id = public.current_workspace_id() and (posted_by = auth.uid() or public.has_workspace_permission('content.templates')));
revoke all on public.content_item_posts from anon, authenticated;
grant select, delete on public.content_item_posts to authenticated;
grant insert (workspace_id, content_item_id, channel, place, posted_by) on public.content_item_posts to authenticated;
grant all on public.content_item_posts to service_role;

commit;
