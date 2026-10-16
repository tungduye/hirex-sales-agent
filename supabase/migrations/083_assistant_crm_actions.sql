-- 083: Trợ lý HireX may propose CRM changes (phase 3): create/edit a contact, add a note to a
-- contact, create/edit a company, update a task. Like every assistant action, nothing runs until the
-- same member presses "Xác nhận"; writes then go through the member's own permissions.
begin;
alter table public.assistant_actions drop constraint assistant_actions_kind_allowed,
  add constraint assistant_actions_kind_allowed check (kind in (
    'CREATE_TASK','SET_LEAD_STATUS','CAMPAIGN_CONTROL','CREATE_CONTENT','AI_RECRUITER_SAFE_STOP','SEND_REPLY','CREATE_RULE',
    'CREATE_CONTACT','UPDATE_CONTACT','ADD_NOTE','CREATE_COMPANY','UPDATE_COMPANY','UPDATE_TASK'));
commit;
