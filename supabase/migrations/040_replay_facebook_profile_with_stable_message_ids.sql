-- Remove only the three projections produced by the interim Facebook Profile
-- parser. They are replayed from stable Messenger message IDs after this deploy.
delete from public.omnichannel_messages
where id in (
  '6b1f628b-3229-498a-ae2d-9e236956d8a2',
  'e3f14171-13d8-4d55-b100-d2101d7542b2',
  '7d252743-08c8-4c10-a674-f1db935a9021'
)
and channel_type='FACEBOOK_PROFILE';

delete from public.channel_inbound_events
where id in (
  'd2bd1bce-0d8a-4268-84be-a84b3f6cfb7f',
  '69fa70b7-15f9-404e-8e50-f9709ed93ca8',
  'a213e327-ca69-46a5-a6d9-d2717e76d688'
);

update public.omnichannel_conversations
set last_message_at=null,unread_count=0,updated_at=clock_timestamp()
where id='1134a7f0-f89a-4c41-af35-fc11b3dd8740'
  and channel_type='FACEBOOK_PROFILE';
