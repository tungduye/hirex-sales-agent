begin;

alter table public.channel_campaigns
  add column if not exists archived_at timestamptz;

create index if not exists channel_campaigns_workspace_archived_idx
  on public.channel_campaigns(workspace_id, archived_at, created_at desc);

commit;
