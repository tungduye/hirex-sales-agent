-- Restore the participant name overwritten by the initial outbound replay.
-- Future outbound events no longer replace inbound participant metadata.
update public.omnichannel_conversations
set metadata=jsonb_set(
  jsonb_set(coalesce(metadata,'{}'::jsonb),'{participantExternalId}',to_jsonb('1647485776944120'::text),true),
  '{participantDisplayName}',to_jsonb('Tung'::text),true
)
where id='1134a7f0-f89a-4c41-af35-fc11b3dd8740'
  and channel_type='FACEBOOK_PROFILE';
