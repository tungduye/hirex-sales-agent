-- 136: Soda may propose removing people from a Zalo group (its nick is a deputy of the group); an admin confirms the card.
begin;
alter table public.assistant_actions drop constraint assistant_actions_kind_allowed,
  add constraint assistant_actions_kind_allowed check (kind in (
    'CREATE_TASK','SET_LEAD_STATUS','CAMPAIGN_CONTROL','CREATE_CONTENT','AI_RECRUITER_SAFE_STOP','SEND_REPLY','CREATE_RULE',
    'CREATE_CONTACT','UPDATE_CONTACT','ADD_NOTE','CREATE_COMPANY','UPDATE_COMPANY','UPDATE_TASK',
    'CREATE_EMAIL_CAMPAIGNS','CREATE_EVENT','CANCEL_EVENT','SET_REMINDER','CREATE_BROADCAST','BULK_INBOX','SAVE_DOCUMENT','REMOVE_GROUP_MEMBERS'));
commit;
