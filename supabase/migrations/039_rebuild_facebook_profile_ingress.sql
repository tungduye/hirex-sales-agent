-- Remove only the four malformed records confirmed during the initial
-- Facebook Profile bridge import. The corrected parser can then replay them.
delete from public.omnichannel_messages
where id in (
  'b85cebcb-9c5f-42fe-8dab-625ab9bf6cf8',
  '6e43eb8d-ceef-4639-8ec1-2f0b6fdcc695',
  '01d3c877-83cf-446f-af66-310b4c43a8be',
  '6f2f3bf8-bfbb-4b9b-8767-1ad8b671ca04'
)
and channel_type='FACEBOOK_PROFILE';

delete from public.channel_inbound_events
where id in (
  'fb559f92-3d3b-4984-bdbc-8e78229b0e9d',
  'b25b9863-8bf3-4d52-ba76-a3a6e182328d',
  'e27bc621-26fc-4a71-bdc7-1f4c41283d45'
);

update public.omnichannel_conversations
set last_message_at=null,unread_count=0,updated_at=clock_timestamp()
where id='1134a7f0-f89a-4c41-af35-fc11b3dd8740'
  and channel_type='FACEBOOK_PROFILE';
