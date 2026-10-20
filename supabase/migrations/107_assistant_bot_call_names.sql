-- 107: names that call the Zalo Trợ lý in a group ("@Soda …"), besides the nick's name in HireX. Renaming the
-- Zalo profile does not rename it in HireX at once, so admins list the names staff will tag.
begin;
alter table public.assistant_bot_settings add column call_names text[] not null default '{}'
  check (cardinality(call_names) <= 10 and array_position(call_names, null) is null);
commit;
