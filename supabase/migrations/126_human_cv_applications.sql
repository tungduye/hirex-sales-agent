-- 126: Màn CV, after the first real copy. Human's /cv list has one row per CV sent to a company (historyId): HireX
-- keeps one row per CV with every company it went to (applications), and the bộ mã is readable with "CV · Xem" too.
begin;

alter table public.human_cvs add column applications jsonb not null default '[]'::jsonb;
alter table public.human_cvs add constraint human_cvs_applications_array check (jsonb_typeof(applications) = 'array');

drop policy human_master_codes_read on public.human_master_codes;
create policy human_master_codes_read on public.human_master_codes for select to authenticated
  using (workspace_id = public.current_workspace_id() and ((select public.has_workspace_permission('customers.view')) or (select public.has_workspace_permission('cvs.view'))));

commit;
