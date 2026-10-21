-- 117: Khách hàng shows Human's names instead of codes (bộ mã of the company: rankings, AM rankings, …), the
-- columns Human really uses (partner_name, typePartner, rankJobId, rateAmId/2, amId, address, CV counts, the
-- status log), and filters on them. Codes are kept per workspace so new ones can be added without a release.
begin;

create table public.human_master_codes (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  master_id bigint not null,
  name text not null,
  kind text,
  primary key (workspace_id, master_id)
);
alter table public.human_master_codes enable row level security;
create policy human_master_codes_read on public.human_master_codes for select to authenticated
  using (workspace_id = public.current_workspace_id() and (select public.has_workspace_permission('customers.view')));
revoke all on public.human_master_codes from anon, authenticated;
grant select on public.human_master_codes to authenticated;
grant all on public.human_master_codes to service_role;

insert into public.human_master_codes(workspace_id, master_id, name, kind)
select w.id, v.master_id, v.name, v.kind from public.workspaces w cross join (values
  (24, 'Hà Nội', 'Địa điểm'),
  (95043, '[Data Sale] IT JP', 'Xếp hạng Combo UV'),
  (95046, '[R&D] Tài Khoản nhân viên', 'Xếp hạng Combo UV'),
  (95044, '[Data Sale] Khác', 'Xếp hạng Combo UV'),
  (200648, '[Data Rec] HRNB', 'Xếp hạng Combo UV'),
  (95037, '[Data Rec] Người Nhật', 'Xếp hạng Combo UV'),
  (200365, '[R&D] Tài khoản quản lý/marketing', 'Xếp hạng Combo UV'),
  (95059, '[R&D] Bài Đăng Sale', 'Xếp hạng Combo UV'),
  (95018, '[Data] Trùng', 'Xếp hạng Combo UV'),
  (200457, '[Data Sale] Người Nhật', 'Xếp hạng Combo UV'),
  (200399, '[R&D] Jobs IT', 'Xếp hạng Combo UV'),
  (95042, '[Data Sale] IT', 'Xếp hạng Combo UV'),
  (200337, 'Test trùng chập', 'Xếp hạng Combo UV'),
  (95049, '[R&D] Bài Đăng Rec', 'Xếp hạng Combo UV'),
  (95016, '[Data Rec] IT JP', 'Xếp hạng Combo UV'),
  (200064, '[R&D] Nhóm Facebook', 'Xếp hạng Combo UV'),
  (95023, '[Data Rec] IT', 'Xếp hạng Combo UV'),
  (95055, '[R&D] Jobs Nhật', 'Xếp hạng Combo UV'),
  (95050, '[R&D] CTV', 'Xếp hạng Combo UV'),
  (200428, 'Trống', 'Xếp hạng Combo UV'),
  (95025, '[R&D] Test tool', 'Xếp hạng Combo UV'),
  (70000, 'Xếp hạng Am', 'Kịch bản'),
  (50010, '[Rec] R1.1', 'Email'),
  (200427, 'Trống', 'Email'),
  (200417, 'Tương tác', 'Email'),
  (50008, '[Rec] New', 'Email'),
  (50000, '[Rec] None', 'Email'),
  (50011, '[Rec] New 1', 'Email'),
  (50005, '[Rec] L1', 'Email'),
  (200390, 'Lỗi nhiều lần', 'Email'),
  (50001, '[Rec] R1', 'Email'),
  (200418, 'Người Nhật', 'Xếp hạng facebook'),
  (200086, 'Group facebook', 'Xếp hạng facebook'),
  (90008, '[Rec] R1.1', 'Xếp hạng facebook'),
  (90009, '[Rec] New 1', 'Xếp hạng facebook'),
  (200415, 'Tương tác', 'Xếp hạng facebook'),
  (90007, '[Rec] New', 'Xếp hạng facebook'),
  (200430, 'Trống', 'Xếp hạng facebook'),
  (90024, '[Rec] HR/HRM/HRD', 'Xếp hạng facebook'),
  (200404, 'Page', 'Xếp hạng facebook'),
  (90001, '[Rec] R1', 'Xếp hạng facebook'),
  (200391, 'Lỗi nhiều lần', 'Xếp hạng facebook'),
  (200266, '[Rec] Lọc nữ', 'Xếp hạng facebook'),
  (90003, '[Rec] L1', 'Xếp hạng facebook'),
  (90016, '[Rec] KXD', 'Xếp hạng facebook'),
  (90017, '[Rec] Brse mục tiêu', 'Xếp hạng facebook'),
  (90006, '[Rec] None', 'Xếp hạng facebook'),
  (85015, '[Rec] KXD', 'Xếp hạng linkedin'),
  (200635, 'Người Nhật', 'Xếp hạng linkedin'),
  (85001, '[Rec] R1.1', 'Xếp hạng linkedin'),
  (85006, '[Rec] None', 'Xếp hạng linkedin'),
  (85003, '[Rec] L1', 'Xếp hạng linkedin'),
  (85000, '[Rec] R1', 'Xếp hạng linkedin'),
  (85019, '[Rec] HR/HRM/HRD', 'Xếp hạng linkedin'),
  (200429, 'Trống', 'Xếp hạng linkedin'),
  (200456, 'WS', 'Xếp hạng linkedin'),
  (85016, '[Rec] Brse mục tiêu', 'Xếp hạng linkedin'),
  (85007, '[Rec] New', 'Xếp hạng linkedin'),
  (85008, '[Rec] New 1', 'Xếp hạng linkedin'),
  (80026, '[Rec] sdt L1', 'Xếp hạng SDT'),
  (200431, 'Trống', 'Xếp hạng SDT'),
  (80003, '[Rec] WS L1', 'Xếp hạng SDT'),
  (80024, '[Rec] WS R1.1', 'Xếp hạng SDT'),
  (80025, '[Rec] sdt R1.1', 'Xếp hạng SDT'),
  (80000, '[Rec] sdt R1', 'Xếp hạng SDT'),
  (80023, '[Rec] WS R1', 'Xếp hạng SDT'),
  (80007, '[Rec] sdt New', 'Xếp hạng SDT'),
  (80011, '[Rec] sdt New 1', 'Xếp hạng SDT'),
  (80006, '[Rec] sdt None', 'Xếp hạng SDT'),
  (200226, 'Hạng 4', 'Xếp hạng Công việc'),
  (200481, 'Hạng 7 (Pending)', 'Xếp hạng Công việc'),
  (200224, 'Hạng 2', 'Xếp hạng Công việc'),
  (200640, 'Hạng 10 (C)', 'Xếp hạng Công việc'),
  (200643, 'Hạng 13 (F)', 'Xếp hạng Công việc'),
  (200642, 'Hạng 12 (E)', 'Xếp hạng Công việc'),
  (200644, 'Hạng 14 (G - Pending)', 'Xếp hạng Công việc'),
  (200420, 'Trùng', 'Xếp hạng Công việc'),
  (200223, 'Hạng 1', 'Xếp hạng Công việc'),
  (200639, 'Hạng 9 (B)', 'Xếp hạng Công việc'),
  (200228, 'Hạng 6', 'Xếp hạng Công việc'),
  (200227, 'Hạng 5', 'Xếp hạng Công việc'),
  (200407, 'Đã có dữ liệu', 'Xếp hạng Công việc'),
  (200638, 'Hạng 8 (A)', 'Xếp hạng Công việc'),
  (200641, 'Hạng 11 (D)', 'Xếp hạng Công việc'),
  (200225, 'Hạng 3', 'Xếp hạng Công việc'),
  (200508, '[AI check] Dev, IT nữ', 'Xếp hạng Am'),
  (200673, '[Ai check] Trùng Website', 'Xếp hạng Am'),
  (200661, 'Sống (AM)', 'Xếp hạng Am'),
  (200259, 'Pending/Bug', 'Xếp hạng Am'),
  (200667, 'MKT T10 Rec', 'Xếp hạng Am'),
  (200260, 'To Do', 'Xếp hạng Am'),
  (200261, 'Doing', 'Xếp hạng Am'),
  (200262, 'Done', 'Xếp hạng Am'),
  (200336, 'Đã liên kết dữ liệu', 'Xếp hạng Am'),
  (200409, 'Duy nhất', 'Xếp hạng Am'),
  (200459, 'To mail', 'Xếp hạng Am'),
  (200463, 'KT 2020', 'Xếp hạng Am'),
  (200464, 'KT 2021', 'Xếp hạng Am'),
  (200465, 'KT 2022', 'Xếp hạng Am'),
  (200466, 'KT 2023', 'Xếp hạng Am'),
  (200467, 'KT 2024', 'Xếp hạng Am'),
  (200468, 'KT 2025', 'Xếp hạng Am'),
  (200469, 'KT 2026', 'Xếp hạng Am'),
  (200483, '[AI check] Brse mục tiêu', 'Xếp hạng Am'),
  (200668, 'MKT T10 Sale', 'Xếp hạng Am'),
  (200268, '[R&D] Tổng tương tác', 'Xếp hạng Am'),
  (200338, 'Đang chạy', 'Xếp hạng Am'),
  (200284, '[Manager] Tương tác KXD - Suối', 'Xếp hạng Am'),
  (200255, 'Intalent', 'Xếp hạng Am'),
  (200257, 'HireX', 'Xếp hạng Am'),
  (200424, '[Manager] *', 'Xếp hạng Am'),
  (200423, '[Manager] **', 'Xếp hạng Am'),
  (200422, '[Manager] ***', 'Xếp hạng Am'),
  (200370, '[Manager] Tương tác mới', 'Xếp hạng Am'),
  (200490, '[AI check] CEO/CTO/Founder Người Việt', 'Xếp hạng Am'),
  (200496, '[AI check] IT Người Nhật', 'Xếp hạng Am'),
  (200497, '[AI check] Brse lọc nữ', 'Xếp hạng Am'),
  (200362, 'Sống (Rec)', 'Xếp hạng Am'),
  (200363, 'Chết', 'Xếp hạng Am'),
  (200421, '[Manager] Tương tác lỗi - Suối nguồn', 'Xếp hạng Am'),
  (200394, 'Chưa xác minh', 'Xếp hạng Am'),
  (200395, 'Đã xác minh', 'Xếp hạng Am'),
  (200364, 'Đang kháng/chờ duyệt', 'Xếp hạng Am'),
  (200488, '[AI check] HR/HRD', 'Xếp hạng Am'),
  (200489, '[AI check] KXD', 'Xếp hạng Am'),
  (200491, '[Ai check] Nam Context', 'Xếp hạng Am'),
  (200493, '[AI check] Dev, IT', 'Xếp hạng Am'),
  (200507, '[AI check] Người Nhật', 'Xếp hạng Am'),
  (200610, '[AI check] CEO/CTO/Founder Người Nhật', 'Xếp hạng Am'),
  (200256, 'Magnet', 'Xếp hạng Am'),
  (200258, 'Human', 'Xếp hạng Am'),
  (71501, 'Trùng', 'Xếp hạng rec'),
  (71503, 'Sale chéo', 'Xếp hạng rec'),
  (71505, 'Sale chéo đầu tiên', 'Xếp hạng rec'),
  (71500, 'Mới', 'Xếp hạng rec'),
  (71504, 'Phỏng Vấn', 'Xếp hạng rec'),
  (71502, 'Được duyệt', 'Xếp hạng rec'),
  (72000, 'Do cũ IT (Nhật)', 'Xếp hạng công ty'),
  (72005, 'Done HĐ IT (Nhật)', 'Xếp hạng công ty'),
  (72001, 'Do IT', 'Xếp hạng công ty'),
  (72003, 'Do cũ IT', 'Xếp hạng công ty'),
  (72002, 'Do IT (Nhật)', 'Xếp hạng công ty'),
  (72004, 'Done HĐ IT', 'Xếp hạng công ty'),
  (37001, '[Rec] L1', 'Zalo'),
  (37010, '[Rec] New 1', 'Zalo'),
  (37008, '[Rec] New', 'Zalo'),
  (37007, '[Rec] None', 'Zalo'),
  (200416, 'Tương tác', 'Zalo'),
  (37003, '[Rec] R1', 'Zalo'),
  (37000, 'Lỗi nhiều lần', 'Zalo'),
  (37011, '[Rec] R1.1', 'Zalo')
) as v(master_id, name, kind)
on conflict (workspace_id, master_id) do update set name = excluded.name, kind = excluded.kind;

alter table public.human_partners
  add column project_rank text,
  add column job_rank text,
  add column am_rank text,
  add column am_rank2 text,
  add column location text,
  add column cv_total integer,
  add column cv_sent integer,
  add column cv_processing integer,
  add column cv_offer integer,
  add column cv_done integer,
  add column human_created_at timestamptz,
  add column human_created_by text,
  add column last_note text,
  add column last_note_at date;

update public.human_partner_blocks set name = 'HĐ Khối Nhật' where block_id = 36310 and name is null;

create or replace function public.human_partner_facets()
returns table(kind text, value text, total bigint)
language sql stable security invoker set search_path = public as $$
  select 'project_rank', coalesce(p.project_rank, ''), count(*) from public.human_partners p where p.workspace_id = public.current_workspace_id() and p.active group by 2
  union all
  select 'job_rank', coalesce(p.job_rank, ''), count(*) from public.human_partners p where p.workspace_id = public.current_workspace_id() and p.active group by 2
  union all
  select 'am_rank', coalesce(p.am_rank, ''), count(*) from public.human_partners p where p.workspace_id = public.current_workspace_id() and p.active group by 2
  union all
  select 'location', coalesce(p.location, ''), count(*) from public.human_partners p where p.workspace_id = public.current_workspace_id() and p.active group by 2
  union all
  select 'block', b::text, count(*) from public.human_partners p cross join unnest(p.block_ids) b where p.workspace_id = public.current_workspace_id() and p.active group by 2
$$;

commit;
