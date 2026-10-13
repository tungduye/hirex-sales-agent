-- Allow Facebook personal-profile identities to be attached to CRM contacts.
begin;

alter table public.contact_channels
  drop constraint if exists contact_channels_type_allowed;

alter table public.contact_channels
  add constraint contact_channels_type_allowed check (
    channel_type in (
      'EMAIL',
      'PHONE',
      'FACEBOOK',
      'FACEBOOK_PROFILE',
      'WHATSAPP',
      'ZALO',
      'VIBER',
      'LINKEDIN',
      'OTHER'
    )
  );

commit;
