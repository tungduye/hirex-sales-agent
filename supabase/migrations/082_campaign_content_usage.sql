-- 082: Content sets for campaigns. A content item from the library is used by at most ONE campaign
-- (email or Zalo/Facebook): content_item_usages has one row per item. Deleting the campaign
-- releases its content; deleting the content removes the row.
begin;

create table public.content_item_usages (
  content_item_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_kind text not null,
  campaign_id uuid not null,
  used_by uuid,
  used_at timestamptz not null default now(),
  constraint content_item_usages_kind_allowed check (campaign_kind in ('EMAIL','CHANNEL')),
  constraint content_item_usages_item_fk foreign key (content_item_id, workspace_id)
    references public.content_items(id, workspace_id) on delete cascade
);
create index content_item_usages_campaign on public.content_item_usages(workspace_id, campaign_kind, campaign_id);

alter table public.content_item_usages enable row level security;
create policy content_item_usages_select on public.content_item_usages for select to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.view'));
revoke all on public.content_item_usages from anon, authenticated;
grant select on public.content_item_usages to authenticated;
grant all on public.content_item_usages to service_role;

-- Unused library content matching the labels, newest first (the caller's RLS applies).
create or replace function public.get_available_content_items(
  p_format text, p_department text, p_category_id uuid, p_language text, p_limit integer
)
returns table(id uuid, code text, title text, body text, job_title text, content_format text, department text, category_id uuid, content_language text, created_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select i.id, i.code, i.title, i.body, i.job_title, i.content_format, i.department, i.category_id, i.content_language, i.created_at
  from public.content_items i
  where i.workspace_id = public.current_workspace_id()
    and (p_format is null or i.content_format = p_format)
    and (p_department is null or i.department = p_department)
    and (p_category_id is null or i.category_id = p_category_id)
    and (p_language is null or i.content_language = p_language)
    and not exists (select 1 from public.content_item_usages u where u.content_item_id = i.id)
  order by i.created_at desc, i.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
revoke all on function public.get_available_content_items(text, text, uuid, text, integer) from public;
grant execute on function public.get_available_content_items(text, text, uuid, text, integer) to authenticated;

-- Deleting a campaign gives its content back to the library.
create or replace function public.release_campaign_content()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.content_item_usages
  where workspace_id = old.workspace_id and campaign_id = old.id
    and campaign_kind = (case when tg_table_name = 'email_campaigns' then 'EMAIL' else 'CHANNEL' end);
  return old;
end;
$$;
revoke all on function public.release_campaign_content() from public;
create trigger email_campaigns_release_content after delete on public.email_campaigns for each row execute function public.release_campaign_content();
create trigger channel_campaigns_release_content after delete on public.channel_campaigns for each row execute function public.release_campaign_content();

commit;
