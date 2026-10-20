-- 100: "Người dùng chính" of each channel account and "Quản lý trực tiếp" of each member.
-- Access (profile_channel_account_access / all_channel_accounts) still decides what a member may see
-- and use; these only decide what Suối Nguồn shows by default: "Của tôi" = accounts whose main user is
-- me, "Team" = mine plus those of the people I manage (directly or below them), "Tất cả" = everything
-- I may access.
begin;

alter table public.channel_accounts add column primary_profile_id uuid,
  add constraint channel_accounts_primary_profile_fk foreign key (primary_profile_id, workspace_id)
    references public.profiles(id, workspace_id) on delete set null (primary_profile_id);
create index channel_accounts_primary_profile on public.channel_accounts(workspace_id, primary_profile_id) where primary_profile_id is not null;
grant select (primary_profile_id) on public.channel_accounts to authenticated;

-- Whoever connected an account is its main user to begin with.
update public.channel_accounts a set primary_profile_id = a.connected_by
where a.primary_profile_id is null and exists (select 1 from public.profiles p where p.id = a.connected_by and p.workspace_id = a.workspace_id);

alter table public.profiles add column manager_id uuid,
  add constraint profiles_manager_fk foreign key (manager_id, workspace_id) references public.profiles(id, workspace_id) on delete set null (manager_id),
  add constraint profiles_manager_not_self check (manager_id is null or manager_id <> id);
create index profiles_manager on public.profiles(workspace_id, manager_id) where manager_id is not null;

commit;
