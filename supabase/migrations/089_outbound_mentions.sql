-- 089: "@Name" tags sent as real Zalo mentions. A manual reply into a Zalo group may carry the mentions
-- ({pos, len, uid}; uid "-1" = @All). Written by the server after checking them; read by the sender.
begin;
alter table public.channel_outbound_actions add column if not exists mentions jsonb;
alter table public.channel_outbound_actions drop constraint if exists channel_outbound_actions_mentions_shape;
alter table public.channel_outbound_actions add constraint channel_outbound_actions_mentions_shape check (
  mentions is null or (jsonb_typeof(mentions) = 'array' and jsonb_array_length(mentions) between 1 and 50
    and channel_type = 'ZALO' and dispatch_source = 'HUMAN_MANUAL'));
commit;
