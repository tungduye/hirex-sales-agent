-- 072: Content template library ("Kho mẫu") and the four content departments.
--  * content_templates: sample posts people pick in the "Tạo content" popup. The AI learns tone,
--    structure and CTA from them only (STYLE_ONLY): facts in a template never reach new content.
--    Seeded for every existing workspace from CONTENT_V2_0_4 / 02_CONTENT_LIBRARY (35 samples).
--  * Departments are fixed to REC (Content Rec), HR (Content HR nội bộ), SALE (Content Sale), CTV.
--  * Briefs gain a JD/facts text, blocked terms (client names etc.), chosen template ids, and a
--    "POST" format (Facebook/Zalo post) to match the templates.
begin;

-- Departments --------------------------------------------------------------
update public.content_batches set department = case department when 'RECRUITING' then 'REC' when 'SALES' then 'SALE' else 'REC' end
  where department not in ('REC','HR','SALE','CTV');
update public.content_items set department = case department when 'RECRUITING' then 'REC' when 'SALES' then 'SALE' else 'REC' end
  where department not in ('REC','HR','SALE','CTV');
alter table public.content_batches drop constraint content_batches_department_not_blank,
  add constraint content_batches_department_allowed check (department in ('REC','HR','SALE','CTV'));
alter table public.content_items add constraint content_items_department_allowed check (department in ('REC','HR','SALE','CTV'));

-- Formats ------------------------------------------------------------------
alter table public.content_batches drop constraint content_batches_format_allowed,
  add constraint content_batches_format_allowed check (content_format in ('POST','EMAIL','ESSAY_100','SUMMARY_50','STORY'));
alter table public.content_items drop constraint content_items_format_allowed,
  add constraint content_items_format_allowed check (content_format in ('POST','EMAIL','ESSAY_100','SUMMARY_50','STORY'));

-- Brief fields -------------------------------------------------------------
alter table public.content_batches
  add column jd_text text,
  add column blocked_terms text,
  add column template_ids uuid[] not null default '{}',
  add constraint content_batches_brief_extra_limits check (
    coalesce(length(jd_text),0) <= 8000 and coalesce(length(blocked_terms),0) <= 1000 and cardinality(template_ids) <= 5);
grant insert (jd_text, blocked_terms, template_ids) on public.content_batches to authenticated;

-- Templates ----------------------------------------------------------------
create sequence if not exists public.content_template_code_seq;

create table public.content_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null default ('MAU-' || lpad(nextval('public.content_template_code_seq')::text, 4, '0')),
  department text not null,
  content_type text,
  group_name text,
  language text not null default 'VI',
  reader text,
  goal text,
  tone text,
  cta text,
  tags text,
  active boolean not null default true,
  weight integer not null default 3,
  body text not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_templates_code_key unique (workspace_id, code),
  constraint content_templates_id_workspace_key unique (id, workspace_id),
  constraint content_templates_creator_fk foreign key (created_by, workspace_id) references public.profiles(id, workspace_id) on delete set null (created_by),
  constraint content_templates_department_allowed check (department in ('REC','HR','SALE','CTV')),
  constraint content_templates_language_allowed check (language in ('VI','EN','JA','VI_EN','VI_JA','EN_JA')),
  constraint content_templates_weight_range check (weight between 1 and 10),
  constraint content_templates_text_limits check (
    btrim(body) <> '' and length(body) <= 8000 and length(code) <= 60
    and coalesce(length(content_type),0) <= 60 and coalesce(length(group_name),0) <= 100
    and coalesce(length(reader),0) <= 200 and coalesce(length(goal),0) <= 300 and coalesce(length(tone),0) <= 200
    and coalesce(length(cta),0) <= 200 and coalesce(length(tags),0) <= 500 and coalesce(length(note),0) <= 1000)
);
create index content_templates_workspace_department on public.content_templates(workspace_id, department, active, weight desc);
create trigger content_templates_set_updated_at before update on public.content_templates for each row execute function public.set_updated_at();

alter table public.content_templates enable row level security;
create policy content_templates_select on public.content_templates for select to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.view'));
create policy content_templates_insert on public.content_templates for insert to authenticated
with check (workspace_id = public.current_workspace_id() and created_by = auth.uid() and public.has_workspace_permission('content.templates'));
create policy content_templates_update on public.content_templates for update to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.templates'))
with check (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.templates'));
create policy content_templates_delete on public.content_templates for delete to authenticated
using (workspace_id = public.current_workspace_id() and public.has_workspace_permission('content.templates'));

revoke all on public.content_templates from anon, authenticated;
grant select, delete on public.content_templates to authenticated;
grant insert (id, workspace_id, department, content_type, group_name, language, reader, goal, tone, cta, tags, active, weight, body, note, created_by)
  on public.content_templates to authenticated;
grant update (department, content_type, group_name, language, reader, goal, tone, cta, tags, active, weight, body, note)
  on public.content_templates to authenticated;
grant usage on sequence public.content_template_code_seq to authenticated;
grant all on public.content_templates to service_role;

-- Administrators manage templates; other roles are granted in Settings > Roles.
insert into public.workspace_role_permissions(workspace_id, role_id, permission_key)
select role.workspace_id, role.id, 'content.templates'
from public.workspace_roles role
where role.is_system = true and role.name = 'Quản trị viên'
on conflict (role_id, permission_key) do nothing;

-- Seed: 35 approved samples from CONTENT_V2_0_4 / 02_CONTENT_LIBRARY, for every workspace.
insert into public.content_templates(workspace_id, code, department, content_type, group_name, language, reader, goal, tone, cta, tags, active, weight, body, note)
select w.id, s.code, s.department, s.content_type, s.group_name, s.language, s.reader, s.goal, s.tone, s.cta, s.tags, s.active, s.weight, s.body, s.note
from public.workspaces w
cross join (values
($t$LEARN_BRSE_001$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$URGENT_RECRUITMENT$t$,$t$VI$t$,$t$Ứng viên mục tiêu$t$,$t$Thu hút ứng viên và tạo inbox/CV$t$,$t$Recruiter gần gũi, trực tiếp$t$,$t$IB / chấm (.) / gửi CV$t$,$t$Salary First;Urgent;Fast Process;Senior;Career Growth$t$,true,5,$t$[Hà Nội] BrSE SENIOR- Lương 70M - 90 gross

Công ty thuần Nhật , tuyển gấp BrSE làm việc tại Cầu Giấy -  Hà Nội, process cực nhanh chỉ 1 vòng, có thể thực hiện online
Phỏng vẫn xong có kết quả luôn

Yêu cầu: Tối thiểu 3 năm kinh nghiệm lập trình, tiếng Nhật N2-N1.
Nhiệm vụ: Quản lý tiến độ, kiểm soát chất lượng code, làm cầu nối kỹ thuật với đối tác.

Anh em Brse nào đang định hướng PM thử job bên em ngay nha$t$,$t$Học urgency/process/salary hook, không học fact cụ thể.$t$),
($t$LEARN_BRSE_002$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$MULTI_ROLE_CAMPAIGN$t$,$t$VI$t$,$t$Ứng viên mục tiêu$t$,$t$Thu hút ứng viên và tạo inbox/CV$t$,$t$Recruiter gần gũi, trực tiếp$t$,$t$IB / chấm (.) / gửi CV$t$,$t$Multi-role;Expansion;Salary Bands;PM;SE;DM$t$,true,5,$t$[Hà Nội] BrSE/PM/DM - OFFER THEO MONG MUỐN

Do hoạt động mở rộng gấp năm 2026, dự án bên em đang tìm thêm 3 bạn Brse thuộc cả rank Brse và Se tiếng Nhật, với chi tiết như sau:

- Rank Brse PM (02): Tập trung hoạt động quản lý, điều phối khách, dự án... khoảng lương 80 Gross
- Rank SE tiếng Nhật (01): Code từ 3 năm các ngôn ngữ web... + từ 1 năm Brse khoảng lương 50-55 Gross

Tất cả quy trình bên em đều đã giản lược, đảm bảo chỉ 1 vòng Duy Nhất, Job đợt này với các ứng viên DM, Manager, bên em có thể đàm phán thêm về mức lương cao hơn rank chi tiết trên. Rất mong anh em Brse/PM ở HN quan tâm ạ

IB em sẽ trả lời anh em 24/24 ngay ạ$t$,$t$Học campaign mở rộng + chia rank + CTA.$t$),
($t$LEARN_BRSE_003$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$SHORT_TEASER$t$,$t$VI$t$,$t$Ứng viên mục tiêu$t$,$t$Thu hút ứng viên và tạo inbox/CV$t$,$t$Recruiter gần gũi, trực tiếp$t$,$t$IB / chấm (.) / gửi CV$t$,$t$One-line;Division Manager;Salary;Japanese$t$,true,4,$t$HN - LƯƠNG DIVISION MANAGER N1/N2 80-100M- ANH EM QUAN TÂM IB EM NHA$t$,$t$Học teaser 1 dòng.$t$),
($t$LEARN_BRSE_004$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$SHORT_TEASER$t$,$t$VI$t$,$t$Ứng viên mục tiêu$t$,$t$Thu hút ứng viên và tạo inbox/CV$t$,$t$Recruiter gần gũi, trực tiếp$t$,$t$IB / chấm (.) / gửi CV$t$,$t$One-line;Urgent;Requirement First;AWS;N1$t$,true,4,$t$HCM - TUYỂN GẤP BRSE/PM VÀO MỞ RỘNG DỰ ÁN - LƯƠNG TỐI THIỂU TỪ 65.000.000- CÓ N1 VÀ TỪ 5 NĂM AWS KINH NGHIỆM$t$,$t$Học teaser requirement-first, không học AWS/N1/lương.$t$),
($t$LEARN_BRSE_005$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$BENEFIT_FIRST$t$,$t$VI$t$,$t$Ứng viên mục tiêu$t$,$t$Thu hút ứng viên và tạo inbox/CV$t$,$t$Recruiter gần gũi, trực tiếp$t$,$t$IB / chấm (.) / gửi CV$t$,$t$Benefits;Japanese Company;High Management;PM;Team Expansion$t$,true,5,$t$[Hà Nội] TÌM KIẾM ĐỒNG ĐỘI BRSE /PM

Công ty Thuần Nhật tại HN đang có nguồn lực từ công ty mẹ tại Nhật, bên em rất chịu chi về các điều kiện và chính sách cho các nhân tài tiếng Nhật. Em đang tìm kiếm thêm 2 vị trí Brse về team quản lý cấp cao, yêu cầu từ N2, ở Nhật tối thiểu 3 năm và đam mê trong công tác brse/pm tại thị trường Việt Nam. Em xin giới thiệu một số chính sách rất hấp dẫn từ tập đoàn

- Bảo hiểm full lương
- Thử việc full lương
- Làm T2-T6
- Đặc biệt thường xuyên thêm các thưởng dự án

Lương rất tốt và sẽ có phỏng vấn với bác Nhật tại Việt Nam, nên anh chị em nào tiếng tốt cứ ib em 24/24 nha$t$,$t$Học EVP/benefit-first + team expansion.$t$),
($t$SRC_SALE_001$t$,$t$SALE$t$,$t$SALE_SHARE_UV$t$,$t$SENIOR_PM_PROFILE$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder / CTO$t$,$t$Giới thiệu ứng viên tới doanh nghiệp và xin JD/CV match$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Osaka; 5 năm Java,; Đang ở Osaka$t$,true,5,$t$Em mới trao đổi được với 1 bác PM người Nhật  chất
+ 15+ năm chinh chiến PM. Tech stack "thép": Nền tảng vững chắc với Java & COBOL – chấp hết các dự án Core Banking, Tài chính, Hệ thống lớn!
+ Hiểu văn hóa Việt: Đã sống & làm việc tại VN gần 1 năm – làm việc với Dev Việt mượt
+ Sở hữu combo chứng chỉ đỉnh cao PMI & PMP.
Sếp nào đang cần "trụ cột" gánh dự án lớn thì nhắn em trao đổi!$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_002$t$,$t$SALE$t$,$t$SALE_SHARE_UV$t$,$t$SENIOR_PM_PROFILE$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder / CTO$t$,$t$Giới thiệu ứng viên tới doanh nghiệp và xin JD/CV match$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Hà Nội; 20+ năm  ngành IT:i 15 năm Code (Javascript, HTML, CSS) + Kinh nghiệm Design.; Đang ở HN$t$,true,5,$t$GIỚI THIỆU PM CẤP CAO NGƯỜI NHẬT QUẢN LÝ SIZE 70 NGƯỜI TẠI HÀ NỘI.

Em gửi sơ bộ kinh nghiệm UV, bác nào đang tuyển cho vị trí này mà open cho headhunt cứ nhắn trực tiếp cho em nhé

20+ năm  ngành IT:i 15 năm Code (Javascript, HTML, CSS) + Kinh nghiệm Design. Một PM vừa hiểu Tech vừa giỏi UX/UI 
7+ năm kinh nghiệm PM chuyên nghiệp: với  các dự án khủng với Size team lên đến 70 người. Quản trị rủi ro, phân bổ nguồn lực hay tối ưu quy trình đều đã đạt mức độ lão luyện.
 Sinh năm 1978
Địa điểm: Đang ở sẵn Hà Nội, cực kỳ thuận tiện cho việc gặp mặt trao đổi trực tiếp.

Em cần giới thiệu gấp ạ$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_003$t$,$t$SALE$t$,$t$SALE_SHARE_UV$t$,$t$SENIOR_PM_PROFILE$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder / CTO$t$,$t$Giới thiệu ứng viên tới doanh nghiệp và xin JD/CV match$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$TP HCM; Tech stack đa năng: 10 năm kinh nghiệm với PHP, C++, Unity (C#).; Sống tại TP.HCM 10+ năm$t$,true,5,$t$Bên nào đang open cho job PM người Nhật trẻ , đã ở Việt Nam gần 10 năm rồi không ạ. Mình đang có UV người Nhật muốn giới thiệu qua, background mạnh về IT


Sống tại TP.HCM 10+ năm, lập gia đình với vợ người Việt nên tâm lý vô cùng cởi mở, am hiểu văn hóa Việt Nam và định hướng làm việc lâu dài.

Tech stack đa năng: 10 năm kinh nghiệm với PHP, C++, Unity (C#). Cân tốt các dự án từ Web, System cho đến Game/Interactive.
Kinh nghiệm PM: 5+ năm quản lý team/dự án, giữ nhịp tiến độ và tối ưu hiệu suất làm việc cực tốt.
Bằng cấp & Chứng chỉ: Tốt nghiệp Học viện Thiết kế Tokyo + Có chứng chỉ FE (Fundamental Information Technology Engineer).
Ngoại ngữ: Tiếng Anh giao tiếp công việc tốt, sẵn sàng cho các dự án đa quốc gia.$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_004$t$,$t$SALE$t$,$t$SALE_SHARE_UV$t$,$t$SENIOR_PM_PROFILE$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder / CTO$t$,$t$Giới thiệu ứng viên tới doanh nghiệp và xin JD/CV match$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Tokyo; 40+ năm di sản CNTT & 20+ năm lãnh đạo PM/PMO:; Sống tại Tokyo$t$,true,5,$t$MÌnh có  khách hàng connect cho 1 bác người Nhật, muốn tìm việc tại Tokyo_Vị trí PM /PMO
Mình xin gửi lại hồ sơ của bác để bên nào cần có thể tham khảo thử

40+ năm di sản CNTT & 20+ năm lãnh đạo PM/PMO: Từng làm chủ các dự án cốt lõi (Core Systems, ERP, CAD/CAM) thuộc những lĩnh vực khắt khe nhất: Banking, Finance, Healthcare, Manufacturing, Education...
Master về Quản trị & Troubleshooting: Trực tiếp điều hành các đội ngũ từ 5 đến 120 thành viên. Quản lý những siêu dự án có ngân sách lên tới 30 tỷ JPY. Anh là chuyên gia hàng đầu trong việc "giải cứu" dự án gặp sự cố, tái cấu trúc hệ thống và quản trị Stakeholder ở mức độ phức tạp nhất.
Quản lý Size 2.000 PMP tại Nhật Bản: Hơn 8 năm giảng dạy PMBOK với 8.000+ giờ đứng lớp, trực tiếp đào tạo lực lượng quản lý dự án cho các tập đoàn siêu quốc gia trong ngành Viễn thông, Ngân hàng, Dược phẩm, Logistics...
Chứng chỉ chuẩn Quốc tế: PMP, ITIL V3 Foundation...

Vị trí  phù hợp: PMO Director / Senior Troubleshooting Advisor / IT Program Director / Cố vấn Cấp cao về Cải tiến Quy trình & Quản trị Dự án.$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_005$t$,$t$SALE$t$,$t$SALE_SHARE_UV$t$,$t$LEADERSHIP_TECH$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder / CTO$t$,$t$Giới thiệu ứng viên tới doanh nghiệp và xin JD/CV match$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Tokyo$t$,true,5,$t$Có bên nào cần UV ở level Techlead/CTO tiếng Nhật không ạ, Mình đang có 1 anh, trước là khách hàng của mình nhưng giờ muốn chuyển môi trường sang làm cho 1 công ty về Product, UV từng  ở Nhật 10 năm rồi. Mình gửi thông tin, bên nào cần thì ới mình nhé.
20+ năm chinh chiến: Kinh nghiệm thực tế trong ngành IT, đi lên từ những dòng code đầu tiên cho đến cấp quản trị cao nhất.
12 năm dẫn dắt bộ sậu: Gồm 7 năm giữ vị trí CTO và 5 năm ở vai trò Director. Không chỉ quản lý con người, mà còn trực tiếp định hình chiến lược công nghệ cho doanh nghiệp.
10+ năm song hành Kỹ thuật & Sản phẩm:
    + Gần 11 năm kinh nghiệm ở các vị trí Code / Technical Lead / Architect (xương sống kỹ thuật).
     + Hơn 10 năm kinh nghiệm vị trí Product / Project Manager (quản trị tiến độ và bài toán kinh doanh).  
Nhắn tin trực tiếp cho mình để mình gửi CV tham khảo ạ.$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_006$t$,$t$SALE$t$,$t$SALE_SHARE_UV$t$,$t$MANAGEMENT_TECH_PROFILE$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder / CTO$t$,$t$Giới thiệu ứng viên tới doanh nghiệp và xin JD/CV match$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Tokyo; 7 năm làm các vị trí lead/quản lý, trong đó 3 năm Delivery Manager và 4 năm BrSE/PM. Ngoài ra có PMP và PMI-ACP.; Tokyo$t$,true,5,$t$Có bên nào ở Tokyo đang cần DM/PM không ạ?
Mình đang có một bạn sinh năm 96, hiện sống ở Tokyo.
Bạn này có khoảng 7 năm làm các vị trí lead/quản lý, trong đó 3 năm Delivery Manager và 4 năm BrSE/PM. Ngoài ra có PMP và PMI-ACP.
Trước khi đi sâu sang quản lý thì bạn ấy làm kỹ thuật khá lâu: PHP khoảng 5 năm, Java 3 năm, Linux 4 năm, AWS khoảng 3 năm.
Tiếng Nhật N2, đã ở Tokyo khoảng 3 năm nên việc trao đổi trực tiếp với khách Nhật không có vấn đề gì.
Mình thấy điểm ổn là bạn ấy không bị tách khỏi kỹ thuật. Nếu dự án có issue thì vẫn có thể ngồi cùng Dev để nói chuyện, chứ không chỉ đứng ngoài quản lý tiến độ.
Nếu bên nào đang cần DM / PM / BrSE senior tại Tokyo thì ới mình nhé, mình gửi CV qua xem thử.$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_007$t$,$t$SALE$t$,$t$SALE_SHARE_UV$t$,$t$MANAGEMENT_TECH_PROFILE$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder / CTO$t$,$t$Giới thiệu ứng viên tới doanh nghiệp và xin JD/CV match$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Đà Nẵng; Web (PHP, TypeScript), Mobile (iOS/Android) trên hạ tầng AWS (EC2, Fargate, CloudFront...); N2$t$,true,5,$t$Delivery Manager Đà Nẵng: Bên em mới trao đổi được với 1 anh 1985  có 18 năm chinh chiến thị trường Nhật, kinh qua mọi vị trí từ SE, TL, BrSE, PM đến Director, vị Delivery Manager (1985) tại Đà Nẵng này chính là "chìa khóa" vận hành chiến lược mà các tập đoàn công nghệ tìm kiếm.
Điểm chạm khác biệt:
+ Quản trị quy mô lớn: Định hướng phát triển năng lực và điều hành bộ máy 50–150 nhân sự bài bản từ con người, công nghệ đến vận hành.
+ Base kỹ thuật thực chiến ("Full-lifecycle"): Dẫn dắt trọn gói từ đề xuất kiến trúc/giải pháp đến triển khai các hệ thống lớn Web (PHP, TypeScript), Mobile (iOS/Android) trên hạ tầng AWS (EC2, Fargate, CloudFront...).
+ Giao tiếp & Đào tạo: Tiếng Nhật N2 giao tiếp trực tiếp hàng ngày với đối tác Nhật; mát tay trong huấn luyện và xây dựng đội ngũ kế thừa.
Một "thủ lĩnh" toàn diện ngay tại Đà Nẵng — sẵn sàng nâng tầm chất lượng và quy mô cho tổ chức của bạn. Mảnh ghép còn thiếu cho Doanh nghiệp nào thì nhắn em ạ.$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_008$t$,$t$SALE$t$,$t$SALE_SHARE_UV$t$,$t$MANAGEMENT_TECH_PROFILE$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder / CTO$t$,$t$Giới thiệu ứng viên tới doanh nghiệp và xin JD/CV match$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Hà Nội; Java, C#, Swift, Kotlin; N2$t$,true,5,$t$Delivery Manager HN: Em trao đổi với 1 anh 1989 Đang sinh sống tại Nhật và chuẩn bị trở về Hà Nội sở hữu 13 năm thực chiến phần mềm, trong đó có gần 6 năm chinh chiến trực tiếp tại xứ sở hoa anh đào. Mong muốn tìm việc tại HN. Bên nào cần chiêu mộ, UV có: 
-  5 năm làm SE thực chiến với Java, C#, Swift, Kotlin... làm nền tảng vững chắc cho 8 năm tiến xa ở các vai trò BrSE, PM và Delivery Manager (DM).
- Kinh nghiệm dẫn dắt các team từ 5 đến 40 nhân sự, làm chủ bài toán tiến độ, chất lượng và tối ưu hóa nguồn lực.
- Thấu hiểu văn hóa Nhật: Trình độ JLPT N2, giao tiếp và làm việc mượt với đối tác Nhật Bản sau gần 6 năm onsite.
Nhắn em hỗ trợ gặp gỡ$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_009$t$,$t$SALE$t$,$t$SALE_SHARE_UV$t$,$t$AI_PROFILE$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder / CTO$t$,$t$Giới thiệu ứng viên tới doanh nghiệp và xin JD/CV match$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Hà Nội; GenAI, RAG, chatbot nội bộ và Data project,  Python, API, AWS; N1$t$,true,5,$t$Doanh nghiệp nào cần BrSE AI ở Hà Nội thử ngắm qua hồ sơ này giúp em: 
• 9 năm kinh nghiệm IT, hơn 4 năm BrSE
• Từng làm GenAI, RAG, chatbot nội bộ và Data project
• Tiếng Nhật N1, trực tiếp họp và clarify requirement
• Có nền tảng Python, API, AWS để trao đổi cùng Dev
 Đang làm việc tại Hà Nội. Điểm mình đánh giá cao nhất: biết lúc nào nên nói “làm được” và lúc nào cần kiểm chứng trước.
Công ty đang tìm nhắn em có thể gửi CV.$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_010$t$,$t$SALE$t$,$t$SALE_SHARE_POOL$t$,$t$POOL_SNAPSHOT$t$,$t$VI$t$,$t$HR / Hiring Manager$t$,$t$Show nguồn ứng viên available và nhận JD phù hợp$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Đà Nẵng; migration/modernization, PoC GenAI; N1$t$,true,5,$t$Tokyo – 5 profile IT senior đang cân nhắc cơ hội mới
Tuần này nguồn Tokyo của bên tôi có vài người khá thú vị:
• PM – N1 – 15 năm IT – hơn 10 năm tại Nhật.

• BrSE AWS – N1 – mạnh migration/modernization.

• BrSE AI – N1 – từng triển khai PoC GenAI cho khách hàng Nhật.

• Java Lead – N1 – 12 năm kinh nghiệm – architecture/team management.

• IT Sales – người Nhật – có network B2B và kinh nghiệm bán giải pháp IT.
Có người muốn chuyển ngay, có người chỉ đổi nếu gặp đúng dự án.
Vì vậy tôi không muốn “rải CV”.
Nếu công ty đang có vị trí khó tuyển tại Tokyo, gửi tôi JD trước. Tôi sẽ nói thẳng profile nào thực sự match và profile nào không.
👉 DM nếu cần danh sách chi tiết.$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_011$t$,$t$SALE$t$,$t$SALE_SHARE_UV$t$,$t$AI_PROFILE$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder / CTO$t$,$t$Giới thiệu ứng viên tới doanh nghiệp và xin JD/CV match$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$TP HCM; AI Application, API Integration và Data Processing, Backend Dev; N1$t$,true,5,$t$Khách nào đang cần BrSE AI tại HCM em sẵn 1 anh xuất thân Developer nên khá hiểu team kỹ thuật. Trước khi làm BrSE, ứng viên có gần 5 năm làm Developer. Vì vậy khi nhận requirement từ khách Nhật, UV nhìn được cả ở góc độ Dev cần gì để estimate và triển khai.
• 11 năm IT, hơn 5 năm BrSE/PM
• Background Backend Development
• Kinh nghiệm AI Application, API Integration và Data Processing
• Tiếng Nhật N1, nhiều năm làm việc trực tiếp với khách Nhật
• Từng quản lý team 8–15 người
 Hiện ở TP.HCM. Một profile khá cân bằng giữa technical, communication và project management, phù hợp với các dự án AI Product, SaaS hoặc DX. Chủ DN hay anh chị Hr nào cần tham khảo UV nhắn em ạ$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_012$t$,$t$SALE$t$,$t$SALE_SHARE_UV$t$,$t$AI_PROFILE$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder / CTO$t$,$t$Giới thiệu ứng viên tới doanh nghiệp và xin JD/CV match$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Tokyo; RAG, LLM, API hay PoC; N1$t$,true,5,$t$Share BrSE AI tại Tokyo
BrSE AI tại Tokyo – kiểu người có thể “ngồi cùng bàn” với khách Nhật từ buổi đầu tiên
Không phải BrSE nào làm AI cũng cần biết train model. Nhưng ít nhất phải đủ hiểu để khách nói về RAG, LLM, API hay PoC mà không phải quay sang hỏi Dev từng câu.
• 10 năm IT, trong đó hơn 4 năm BrSE/PM cho dự án Nhật.

• 2 năm gần đây tham gia các dự án GenAI, chatbot nội bộ, RAG và tích hợp API AI.

• Nhật N1, đang sống tại Tokyo, quen trực tiếp họp requirement và demo với khách hàng.

• Background kỹ thuật: Python, AWS, API, SQL; đủ sâu để bridge mà không trở thành “phiên dịch IT”.
Điểm tôi thích ở profile này là không cố nói AI quá to tát. Khách hỏi gì thì bóc requirement, xác định cái nào làm được, cái nào cần PoC trước.
👉 Nếu team đang cần BrSE cho dự án AI tại Nhật, inbox tôi lấy CV nhé.$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_013$t$,$t$SALE$t$,$t$SALE_SHARE_UV$t$,$t$NICHE_PROFILE$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder / CTO$t$,$t$Giới thiệu ứng viên tới doanh nghiệp và xin JD/CV match$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Đà Nẵng; N2$t$,true,5,$t$Nguồn BrSE SAP tại Đà Nẵng vốn không nhiều, nên profile này tôi nghĩ khá đáng chú ý. • 9 năm kinh nghiệm IT. • 4 năm làm BrSE cho dự án ERP/SAP khách Nhật. • Có kinh nghiệm SAP SD/MM và vận hành hệ thống sau go-live. • Nhật N2 tốt, từng onsite Nhật hơn 1 năm. • Có thể làm requirement, issue management, progress report và support UAT. • Hiện tại Đà Nẵng, chưa có ý định chuyển location. Đây không phải profile quá “consulting”, nhưng lại khá phù hợp với các team cần một người bridge thực chiến giữa khách Nhật và đội delivery tại Việt Nam.$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_014$t$,$t$SALE$t$,$t$SALE_SHARE_UV$t$,$t$NICHE_PROFILE$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder / CTO$t$,$t$Giới thiệu ứng viên tới doanh nghiệp và xin JD/CV match$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Tokyo; N2$t$,true,5,$t$Tokyo – BrSE SAP có thể đứng onsite phía khách hàng, không chỉ làm Offshore coordination Profile này tôi đánh giá cao ở khả năng đứng khá gần phía user. • 14 năm kinh nghiệm IT, trong đó hơn 8 năm liên quan SAP. • SAP SD/MM, từng tham gia rollout và migration. • BrSE/PM hơn 5 năm, có kinh nghiệm onsite dài hạn tại khách Nhật. • Nhật N1, có thể điều phối meeting, UAT, issue và change request. • Hiện đang ở Tokyo, open với onsite/hybrid. Nếu công ty đang tìm một người có thể ngồi phía khách, hiểu nghiệp vụ, sau đó kéo requirement về team delivery, đây là profile khá đúng. Không phải kiểu candidate muốn nhảy nhanh. Ứng viên đang ưu tiên dự án dài hạn và môi trường có ownership rõ.$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_015$t$,$t$SALE$t$,$t$SALE_CHIEN_DICH$t$,$t$REFERRAL_CAMPAIGN$t$,$t$VI$t$,$t$Doanh nghiệp / HR / Network$t$,$t$Tạo lead cho referral/ưu đãi/chương trình sale$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Hà Nội$t$,true,5,$t$GIỚI THIỆU HEADUNT: Biến 1 tin nhắn quen biết thành... khoản bonus 8 chữ số? Nếu bạn biết công ty nào đang đỏ mắt tìm CTO, BrSE hay đội Dev cứng — chỉ cần chốt một lời giới thiệu, phần còn lại để em lo. Đảm bảo Hoa hồng cực "đậm"cho mỗi deal chốt thành công. Chỉ gửi thông tin, đội em sẽ tự tư vấn, Bảo mật 100%: Rõ ràng, minh bạch, hoa hồng ngay khi ứng viên Onboard. 👉 Nhắn em thông tin doanh nghiệp đang cần tuyển để mở khóa cơ chế Referral độc quyền!$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_016$t$,$t$SALE$t$,$t$SALE_DICH_VU$t$,$t$SERVICE_EXPLAINER$t$,$t$VI$t$,$t$HR / Hiring Manager / Founder$t$,$t$Tạo lead dịch vụ headhunt và nhận JD$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Hà Nội$t$,true,5,$t$Dịch vụ Headhunt (Săn nhân sự cao cấp) là giải pháp giúp doanh nghiệp chủ động tìm kiếm và chiêu mộ đúng người cho các vị trí khó, nhân sự cấp cao hoặc nhân sự chuyên môn hiếm. 1. Lợi ích cốt lõi Tiếp cận ứng viên "thụ động": Tiếp cận trực tiếp nhân sự giỏi đang làm việc ổn định, không chủ động rải CV. Tiết kiệm thời gian: Chỉ nhận CV đã qua sàng lọc kỹ về năng lực, mức lương và độ phù hợp văn hóa. Bảo mật tuyệt đối: Giữ kín thông tin tuyển dụng nhạy cảm hoặc kế hoạch kinh doanh mới. 2. Quy trình làm việc Trao đổi nhu cầu: Nhận JD và chốt tiêu chí tuyển dụng. Săn & Sàng lọc: Tiếp cận, phỏng vấn sơ bộ ứng viên. Giới thiệu: Gửi các ứng viên phù hợp nhất cho doanh nghiệp phỏng vấn. Onboard & Bảo hành: Đồng hành thương lượng offer và thay thế miễn phí nếu ứng viên nghỉ trong thời gian thử việc (thường 2 - 3 tháng). Bên anh/chị đang cần tìm vị trí nào, gửi JD em hỗ trợ tìm ứng viên ngay nhé!$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_017$t$,$t$SALE$t$,$t$SALE_DICH_VU$t$,$t$SERVICE_EXPLAINER$t$,$t$JA$t$,$t$HR / Hiring Manager / Founder$t$,$t$Tạo lead dịch vụ headhunt và nhận JD$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Hà Nội$t$,true,5,$t$「応募は来る。でも採用できない。」そんなIT求人はありませんか？ 採用担当者の方とお話ししていると、よく聞くのがこのケースです。 候補者はいる。 面接もしている。 でも、なかなか決まらない。 技術は合うけど日本語が弱い。 日本語はいいけど経験が足りない。 経験はいいけど年収が合わない。 IT採用は、ひとつの条件だけでは決まりません。 HireX Globalでは、日本市場向けにBrSE、PM、PL、SE、Tech Lead、IT Consultant、日本語対応可能なエンジニアをご紹介しています。 日本在住者だけでなく、ベトナム側の日本語人材も対応可能です。 弊社が大切にしているのは、CVの“数”よりも“合っているかどうか”。 もし長期間クローズできていないポジションがございましたら、一度JDをお送りください。 👉 マッチする人材がいるか、まず確認いたします。$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$SRC_SALE_018$t$,$t$SALE$t$,$t$SALE_CHIEN_DICH$t$,$t$OFFER_CAMPAIGN$t$,$t$VI$t$,$t$Doanh nghiệp / HR / Network$t$,$t$Tạo lead cho referral/ưu đãi/chương trình sale$t$,$t$Theo đúng giọng bài nguồn$t$,$t$Xin JD / gửi CV / inbox tùy mục tiêu$t$,$t$Hà Nội$t$,true,5,$t$Có JD đang tuyển? Tháng này có thể là thời điểm tốt để thử thêm một nguồn ứng viên Có một tình trạng tôi gặp khá thường xuyên khi trao đổi với doanh nghiệp: JD đã mở, vị trí vẫn cần người, nhưng sau nhiều tuần hoặc nhiều tháng vẫn chưa có ứng viên thực sự phù hợp. Trong thời gian này, HireX Global đang có chính sách phí tốt dành cho một số vị trí IT phục vụ thị trường Nhật. Các vị trí áp dụng: BrSE, PM, PL, SE, Tech Lead, kỹ sư tiếng Nhật, nhân sự cho dự án Nhật – Việt. Nếu công ty anh/chị đang có một vài vị trí khó tuyển, có thể gửi JD cho tôi trước. Bên tôi sẽ check nguồn ứng viên hiện có. Có profile phù hợp thì hai bên trao đổi tiếp. Chưa phù hợp thì cũng không mất nhiều thời gian của anh/chị. Nếu cần thông tin về chính sách phí hiện tại, anh/chị có thể nhắn trực tiếp cho tôi.$t$,$t$Mẫu nguồn lấy trực tiếp từ file người dùng.$t$),
($t$REC_OLD_C01_STYLE_01$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$REC_STYLE_01_STORYTELLING$t$,$t$VI$t$,$t$Ứng viên IT / IT Nhật$t$,$t$Thu hút ứng viên, tạo inbox, CV$t$,$t$Giọng recruiter thực tế, có nhịp kể chuyện và góc nhìn nghề nghiệp$t$,$t$CTA theo bài mẫu cũ, không sử dụng một câu lặp toàn bộ$t$,$t$STYLE_01; old quality reference; natural recruiter; Storytelling$t$,true,5,$t$[Hà Nội] BrSE C++/C# - N2/N1 - 40–55M gross

Nói thật, tìm một BrSE ở Hà Nội vừa giao tiếp được với phía Nhật, vừa hiểu sâu phần kỹ thuật không dễ.

Job bên em đang cần người có tối thiểu 3 năm kinh nghiệm lập trình, đã từng làm BrSE và có thể làm việc với nền tảng C++ hoặc C#.

Tiếng Nhật yêu cầu N2 hoặc N1. Mức lương trong khoảng 40–55M gross, tùy theo năng lực và kinh nghiệm thực tế.

Anh em BrSE đang muốn tìm một job vẫn dùng tiếng Nhật nhưng không tách rời technical thì IB em trao đổi thêm nha.$t$,$t$MẪU THAM CHIẾU từ output cũ, KHÔNG phải duyệt fact. STYLE_ONLY. Không sao chép lương, địa điểm, công ty, tech, số năm hay tình huống cá nhân.$t$),
($t$REC_OLD_C02_STYLE_03$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$REC_STYLE_03_SHORT_HOOK$t$,$t$VI$t$,$t$Ứng viên IT / IT Nhật$t$,$t$Thu hút ứng viên, tạo inbox, CV$t$,$t$Giọng recruiter thực tế, có nhịp kể chuyện và góc nhìn nghề nghiệp$t$,$t$CTA theo bài mẫu cũ, không sử dụng một câu lặp toàn bộ$t$,$t$STYLE_03; old quality reference; natural recruiter; Short Hook$t$,true,5,$t$[Hà Nội] BrSE - 40–55M gross - C++/C#

Tôi đang có job BrSE tại Hà Nội, range 40–55M gross.

Job này hợp với anh em đã có tối thiểu 3 năm kinh nghiệm lập trình, từng làm BrSE và có nền tảng C++ hoặc C#.

Tiếng Nhật cần từ N2 hoặc N1.

Profile đang đúng range này, anh em nhắn tôi để trao đổi JD chi tiết nhé.$t$,$t$MẪU THAM CHIẾU từ output cũ, KHÔNG phải duyệt fact. STYLE_ONLY. Không sao chép lương, địa điểm, công ty, tech, số năm hay tình huống cá nhân.$t$),
($t$REC_OLD_C03_STYLE_06$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$REC_STYLE_06_TECHNICAL_FIRST$t$,$t$VI$t$,$t$Ứng viên IT / IT Nhật$t$,$t$Thu hút ứng viên, tạo inbox, CV$t$,$t$Giọng recruiter thực tế, có nhịp kể chuyện và góc nhìn nghề nghiệp$t$,$t$CTA theo bài mẫu cũ, không sử dụng một câu lặp toàn bộ$t$,$t$STYLE_06; old quality reference; natural recruiter; Technical First$t$,true,5,$t$[Hà Nội] BrSE technical - C++/C# - N2/N1

C++ hoặc C# là nền tảng chính của job BrSE này.

Đây không phải vị trí chỉ tập trung vào giao tiếp. Ứng viên cần có tối thiểu 3 năm kinh nghiệm lập trình, đồng thời đã có kinh nghiệm BrSE để theo sát và trao đổi các vấn đề kỹ thuật.

Tiếng Nhật yêu cầu N2 hoặc N1.
Mức lương: 40–55M gross.
Địa điểm: Hà Nội.

Anh em thấy stack và yêu cầu phù hợp thì chấm một dấu (.) hoặc IB em nhé.$t$,$t$MẪU THAM CHIẾU từ output cũ, KHÔNG phải duyệt fact. STYLE_ONLY. Không sao chép lương, địa điểm, công ty, tech, số năm hay tình huống cá nhân.$t$),
($t$REC_OLD_C04_STYLE_16$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$REC_STYLE_16_ONE_LINE_TEASER$t$,$t$VI$t$,$t$Ứng viên IT / IT Nhật$t$,$t$Thu hút ứng viên, tạo inbox, CV$t$,$t$Giọng recruiter thực tế, có nhịp kể chuyện và góc nhìn nghề nghiệp$t$,$t$CTA theo bài mẫu cũ, không sử dụng một câu lặp toàn bộ$t$,$t$STYLE_16; old quality reference; natural recruiter; One-line Teaser$t$,true,5,$t$[Hà Nội] BrSE C++/C# - 40–55M gross

[Hà Nội] BrSE C++/C# - 40–55M gross, yêu cầu N2/N1 và tối thiểu 3 năm lập trình, có kinh nghiệm BrSE. Quan tâm IB em nhé.$t$,$t$MẪU THAM CHIẾU từ output cũ, KHÔNG phải duyệt fact. STYLE_ONLY. Không sao chép lương, địa điểm, công ty, tech, số năm hay tình huống cá nhân.$t$),
($t$REC_OLD_C05_STYLE_04$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$REC_STYLE_04_PAIN_POINT$t$,$t$VI$t$,$t$Ứng viên IT / IT Nhật$t$,$t$Thu hút ứng viên, tạo inbox, CV$t$,$t$Giọng recruiter thực tế, có nhịp kể chuyện và góc nhìn nghề nghiệp$t$,$t$CTA theo bài mẫu cũ, không sử dụng một câu lặp toàn bộ$t$,$t$STYLE_04; old quality reference; natural recruiter; Pain Point$t$,true,5,$t$[Hà Nội] BrSE cho ứng viên có nền tảng C++/C#

Có nền tảng lập trình nhưng muốn đi sâu hơn vào vai trò kết nối kỹ thuật? Job BrSE tại Hà Nội đang tìm ứng viên có tối thiểu 3 năm kinh nghiệm lập trình, từng làm BrSE và sử dụng tiếng Nhật N2/N1. Tech stack chính là C++/C#. Anh em thấy đúng hướng có thể IB em trao đổi thêm nha.$t$,$t$MẪU THAM CHIẾU từ output cũ, KHÔNG phải duyệt fact. STYLE_ONLY. Không sao chép lương, địa điểm, công ty, tech, số năm hay tình huống cá nhân.$t$),
($t$REC_OLD_C06_STYLE_08$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$REC_STYLE_08_SALARY_FIRST$t$,$t$VI$t$,$t$Ứng viên IT / IT Nhật$t$,$t$Thu hút ứng viên, tạo inbox, CV$t$,$t$Giọng recruiter thực tế, có nhịp kể chuyện và góc nhìn nghề nghiệp$t$,$t$CTA theo bài mẫu cũ, không sử dụng một câu lặp toàn bộ$t$,$t$STYLE_08; old quality reference; natural recruiter; Salary First$t$,true,5,$t$[Hà Nội] BrSE - 40–55M gross cho nền tảng C++/C#

40–55M gross cho vị trí BrSE tại Hà Nội. Tôi đang tìm ứng viên có tối thiểu 3 năm kinh nghiệm lập trình, có kinh nghiệm BrSE và tiếng Nhật N2 hoặc N1; tech stack gồm C++/C#. Profile phù hợp có thể nhắn tôi để trao đổi thêm.$t$,$t$MẪU THAM CHIẾU từ output cũ, KHÔNG phải duyệt fact. STYLE_ONLY. Không sao chép lương, địa điểm, công ty, tech, số năm hay tình huống cá nhân.$t$),
($t$REC_OLD_C07_STYLE_07$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$REC_STYLE_07_JAPANESE_FIRST$t$,$t$VI$t$,$t$Ứng viên IT / IT Nhật$t$,$t$Thu hút ứng viên, tạo inbox, CV$t$,$t$Giọng recruiter thực tế, có nhịp kể chuyện và góc nhìn nghề nghiệp$t$,$t$CTA theo bài mẫu cũ, không sử dụng một câu lặp toàn bộ$t$,$t$STYLE_07; old quality reference; natural recruiter; Japanese First$t$,true,5,$t$[Hà Nội] BrSE - C++/C# × Tiếng Nhật N2/N1 - 40–55M gross

Tiếng Nhật sẽ có giá trị hơn nhiều khi đi cùng nền tảng lập trình đủ chắc.

Job BrSE tại Hà Nội đang tìm ứng viên có:
- Tối thiểu 3 năm kinh nghiệm lập trình
- Có kinh nghiệm làm BrSE
- Sử dụng C++ hoặc C#
- Tiếng Nhật N2 hoặc N1

Range lương: 40–55M gross.

Anh em có technical base và đang muốn đi sâu hơn theo hướng BrSE, quan tâm job cứ IB em nhé.$t$,$t$MẪU THAM CHIẾU từ output cũ, KHÔNG phải duyệt fact. STYLE_ONLY. Không sao chép lương, địa điểm, công ty, tech, số năm hay tình huống cá nhân.$t$),
($t$REC_OLD_C08_STYLE_02$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$REC_STYLE_02_PROFESSIONAL$t$,$t$VI$t$,$t$Ứng viên IT / IT Nhật$t$,$t$Thu hút ứng viên, tạo inbox, CV$t$,$t$Giọng recruiter thực tế, có nhịp kể chuyện và góc nhìn nghề nghiệp$t$,$t$CTA theo bài mẫu cũ, không sử dụng một câu lặp toàn bộ$t$,$t$STYLE_02; old quality reference; natural recruiter; Professional$t$,true,5,$t$[Hà Nội] Tuyển BrSE - C++/C# - Lương 40–55M gross

Thông tin tuyển dụng lần này khá rõ ràng cho vị trí BrSE tại Hà Nội.

Ứng viên cần đáp ứng các tiêu chí chính:
- Tối thiểu 3 năm kinh nghiệm lập trình
- Đã có kinh nghiệm BrSE
- Có nền tảng C++ hoặc C#
- Tiếng Nhật N2 hoặc N1

Mức lương: 40–55M gross.

Nếu profile của anh chị đang đúng các tiêu chí trên, chấm một dấu hoặc IB em để trao đổi thêm về job ạ.$t$,$t$MẪU THAM CHIẾU từ output cũ, KHÔNG phải duyệt fact. STYLE_ONLY. Không sao chép lương, địa điểm, công ty, tech, số năm hay tình huống cá nhân.$t$),
($t$REC_OLD_C09_STYLE_09$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$REC_STYLE_09_CANDIDATE_PERSONA$t$,$t$JA$t$,$t$Ứng viên IT / IT Nhật$t$,$t$Thu hút ứng viên, tạo inbox, CV$t$,$t$Giọng recruiter thực tế, có nhịp kể chuyện và góc nhìn nghề nghiệp$t$,$t$CTA theo bài mẫu cũ, không sử dụng một câu lặp toàn bộ$t$,$t$STYLE_09; old quality reference; natural recruiter; Candidate Persona$t$,true,5,$t$[Hà Nội] C++/C#経験者向けBrSE｜日本語N2/N1｜40〜55M gross

C++またはC#での開発経験があり、日本語を使うBrSEポジションを探している方へ。

今回の募集では、以下の経験・スキルが求められています。
・開発経験3年以上
・BrSE経験
・日本語N2またはN1

勤務地はハノイ、給与は40〜55M grossです。

ご自身の経験が条件に合いそうでしたら、詳細をお気軽にお問い合わせください。$t$,$t$MẪU THAM CHIẾU từ output cũ, KHÔNG phải duyệt fact. STYLE_ONLY. Không sao chép lương, địa điểm, công ty, tech, số năm hay tình huống cá nhân.$t$),
($t$REC_OLD_C10_STYLE_12$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$REC_STYLE_12_JOB_SNAPSHOT$t$,$t$VI_JA$t$,$t$Ứng viên IT / IT Nhật$t$,$t$Thu hút ứng viên, tạo inbox, CV$t$,$t$Giọng recruiter thực tế, có nhịp kể chuyện và góc nhìn nghề nghiệp$t$,$t$CTA theo bài mẫu cũ, không sử dụng một câu lặp toàn bộ$t$,$t$STYLE_12; old quality reference; natural recruiter; Job Snapshot$t$,true,5,$t$[Hà Nội] BrSE｜C++/C#｜N2/N1｜40–55M gross

[JP]
【Hà Nội】BrSEポジション｜C++/C#｜給与40–55M gross

C++またはC#での開発経験があり、BrSE経験もお持ちの方を対象としたポジションです。開発経験は3年以上、日本語はN2またはN1が必要です。

技術理解と日本語力の両方を活かして、BrSEとして働きたい方に合う求人です。

詳細を確認したい方は、お気軽にご連絡ください。

[VI]
【Hà Nội】BrSE｜C++/C#｜N2/N1｜40–55M gross

Job yêu cầu tối thiểu 3 năm kinh nghiệm lập trình, có kinh nghiệm BrSE và tiếng Nhật N2 hoặc N1.

Tech stack chính là C++/C#. Phù hợp với anh em vừa có nền tảng kỹ thuật, vừa muốn phát huy tiếng Nhật trong vai trò BrSE.

Quan tâm job cứ IB em để nhận thêm thông tin nhé.$t$,$t$MẪU THAM CHIẾU từ output cũ, KHÔNG phải duyệt fact. STYLE_ONLY. Không sao chép lương, địa điểm, công ty, tech, số năm hay tình huống cá nhân.$t$),
($t$REC_OLD_C11_STYLE_11$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$REC_STYLE_11_MARKET_INSIGHT$t$,$t$VI_EN$t$,$t$Ứng viên IT / IT Nhật$t$,$t$Thu hút ứng viên, tạo inbox, CV$t$,$t$Giọng recruiter thực tế, có nhịp kể chuyện và góc nhìn nghề nghiệp$t$,$t$CTA theo bài mẫu cũ, không sử dụng một câu lặp toàn bộ$t$,$t$STYLE_11; old quality reference; natural recruiter; Market Insight$t$,true,5,$t$[Hà Nội] BrSE C++/C# - 40–55M gross

[EN]
In BrSE work, technical understanding is still a key part of the value you bring to the role. I’m currently sharing a Hà Nội position for candidates who can combine development experience with Japanese communication.

The role requires at least 3 years of programming experience, prior BrSE experience, and Japanese at N2 or N1 level. The main technical background is C++ or C#.

Salary range: 40–55M gross. If this matches your profile, I’d be happy to discuss the job in more detail.

[VI]
Trong công việc BrSE, nền tảng kỹ thuật vẫn là phần rất quan trọng. Tôi đang có job tại Hà Nội dành cho ứng viên vừa có kinh nghiệm lập trình, vừa đã từng làm BrSE và sử dụng tiếng Nhật tốt.

Yêu cầu cụ thể: tối thiểu 3 năm kinh nghiệm lập trình, có kinh nghiệm BrSE, tiếng Nhật N2 hoặc N1. Tech stack là C++/C#.

Range 40–55M gross. Profile phù hợp có thể nhắn tôi trao đổi thêm nhé.$t$,$t$MẪU THAM CHIẾU từ output cũ, KHÔNG phải duyệt fact. STYLE_ONLY. Không sao chép lương, địa điểm, công ty, tech, số năm hay tình huống cá nhân.$t$),
($t$REC_OLD_C12_STYLE_05$t$,$t$REC$t$,$t$TUYEN_DUNG$t$,$t$REC_STYLE_05_CAREER_GROWTH$t$,$t$EN_JA$t$,$t$Ứng viên IT / IT Nhật$t$,$t$Thu hút ứng viên, tạo inbox, CV$t$,$t$Giọng recruiter thực tế, có nhịp kể chuyện và góc nhìn nghề nghiệp$t$,$t$CTA theo bài mẫu cũ, không sử dụng một câu lặp toàn bộ$t$,$t$STYLE_05; old quality reference; natural recruiter; Career Growth$t$,true,5,$t$[Hà Nội] BrSE with C++/C# Background - 40–55M gross

[EN]
For a developer who already has BrSE experience, the next step can be to make stronger use of both technical knowledge and Japanese communication. This Hà Nội opening is a fit for that direction.

The role looks for at least 3 years of programming experience, previous BrSE experience, and Japanese at N2 or N1 level. C++ or C# is the relevant technical background.

Salary is 40–55M gross. Interested in discussing whether this move fits your current path? Feel free to reach out.

[JP]
開発経験とBrSE経験の両方を持つ方にとって、技術知識と日本語力をさらに活かせるポジションです。キャリアの幅を広げたい方は、ぜひご検討ください。

勤務地はHà Nội。3年以上のプログラミング経験、BrSE経験、日本語N2またはN1が応募条件です。技術領域はC++またはC#です。

給与は40–55M gross。ご自身のキャリアに合うか確認したい方は、お気軽にご連絡ください。$t$,$t$MẪU THAM CHIẾU từ output cũ, KHÔNG phải duyệt fact. STYLE_ONLY. Không sao chép lương, địa điểm, công ty, tech, số năm hay tình huống cá nhân.$t$)
) s(code, department, content_type, group_name, language, reader, goal, tone, cta, tags, active, weight, body, note)
on conflict (workspace_id, code) do nothing;

commit;
