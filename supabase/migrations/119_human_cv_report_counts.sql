-- 119: Khách hàng · CV counts from the per-company CV report (chờ gửi / đã gửi / fail), which are more accurate
-- than the counters on Human's company list; filled whenever a report is fetched.
begin;
alter table public.human_partners
  add column report_waiting integer,
  add column report_sent integer,
  add column report_failed integer;
commit;
