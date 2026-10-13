alter table public.email_campaign_steps
  add column if not exists body_html_template text;

alter table public.email_campaign_steps
  add constraint email_campaign_steps_body_html_template_check
  check (body_html_template is null or length(body_html_template) between 1 and 200000);

alter table public.email_campaigns
  add column if not exists archived_at timestamptz;

create index if not exists email_campaigns_workspace_archived_idx
  on public.email_campaigns(workspace_id,archived_at,created_at desc);

grant select(body_html_template) on public.email_campaign_steps to authenticated;
grant select(archived_at) on public.email_campaigns to authenticated;
