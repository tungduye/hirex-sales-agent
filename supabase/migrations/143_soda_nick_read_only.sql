-- The Zalo Trợ lý nick (Soda) answers staff by itself. Its main user now sees its chats in Suối Nguồn, read-only:
-- a member can never send from that nick (manual message, file, approval of a draft…); Soda's own replies are sent by
-- the server (service role) and are not affected.
begin;
create or replace function public.guard_assistant_bot_outbound()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' and exists (
    select 1 from public.assistant_bot_settings b
    where b.workspace_id = new.workspace_id and b.enabled and b.channel_account_id = new.channel_account_id) then
    raise exception 'ASSISTANT_BOT_READ_ONLY' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_assistant_bot_outbound() from public, anon, authenticated;
drop trigger if exists guard_assistant_bot_outbound on public.channel_outbound_actions;
create trigger guard_assistant_bot_outbound before insert on public.channel_outbound_actions
for each row execute function public.guard_assistant_bot_outbound();
commit;
