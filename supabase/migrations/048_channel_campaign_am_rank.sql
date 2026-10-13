alter table public.channel_campaigns
  add column if not exists am_rank text;

alter table public.channel_campaigns
  drop constraint if exists channel_campaigns_am_rank_length;

alter table public.channel_campaigns
  add constraint channel_campaigns_am_rank_length
  check (am_rank is null or char_length(am_rank) <= 200);

