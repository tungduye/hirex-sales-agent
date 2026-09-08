begin;
create table public.email_campaign_worker_runs(
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'RUNNING' check(status in('RUNNING','SUCCEEDED','FAILED','DRY_RUN')),
  trigger_type text not null check(trigger_type in('SCHEDULER','MANUAL','DRY_RUN')),
  campaigns_considered integer not null default 0 check(campaigns_considered>=0),
  deliveries_processed integer not null default 0 check(deliveries_processed>=0),
  sent integer not null default 0 check(sent>=0),
  failed integer not null default 0 check(failed>=0),
  delivery_unknown integer not null default 0 check(delivery_unknown>=0),
  replied_stopped integer not null default 0 check(replied_stopped>=0),
  bounced_stopped integer not null default 0 check(bounced_stopped>=0),
  unsubscribed_stopped integer not null default 0 check(unsubscribed_stopped>=0),
  safe_error_code text,
  constraint email_campaign_worker_runs_finish_shape check((status='RUNNING')=(finished_at is null))
);
create index email_campaign_worker_runs_started_idx on public.email_campaign_worker_runs(started_at desc);
create index email_campaign_worker_runs_success_idx on public.email_campaign_worker_runs(finished_at desc) where status in('SUCCEEDED','DRY_RUN');
alter table public.email_campaign_worker_runs enable row level security;
revoke all on public.email_campaign_worker_runs from public,anon,authenticated;
comment on table public.email_campaign_worker_runs is 'Server-only bounded operational heartbeat; contains counts and safe codes only, never message or recipient content.';
commit;
