-- 076: Trợ lý HireX may propose sending one reply in a conversation (SEND_REPLY).
-- Like every assistant action it only runs after the member presses "Xác nhận"; the text can be
-- edited on the card first, and delivery goes through the normal manual-reply path of Hồ Chứa
-- (policy check, idempotency key, channel access, one send).
begin;
alter table public.assistant_actions drop constraint assistant_actions_kind_allowed,
  add constraint assistant_actions_kind_allowed check (kind in ('CREATE_TASK','SET_LEAD_STATUS','CAMPAIGN_CONTROL','CREATE_CONTENT','AI_RECRUITER_SAFE_STOP','SEND_REPLY'));
commit;
