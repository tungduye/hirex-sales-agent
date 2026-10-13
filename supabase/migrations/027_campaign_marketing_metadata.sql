alter table public.email_campaigns
  add column combo_uv text,
  add column placement text,
  add column channel_rank text,
  add column owner_name text;

alter table public.email_campaigns
  add constraint email_campaigns_combo_uv_length check (combo_uv is null or char_length(combo_uv) <= 200),
  add constraint email_campaigns_placement_length check (placement is null or char_length(placement) <= 200),
  add constraint email_campaigns_channel_rank_length check (channel_rank is null or char_length(channel_rank) <= 200),
  add constraint email_campaigns_owner_name_length check (owner_name is null or char_length(owner_name) <= 200);
