import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleChannelAccountIds } from "@/modules/access/server/access-control";
import { metadataName } from "@/modules/assistant/core/assistant-tools";
import { kpiRange, type KpiPeriod } from "@/modules/assistant/core/kpi-range";
import type { ActionContext } from "@/modules/assistant/server/assistant-proposals";
import { teamOf } from "@/modules/inbox/core/inbox-scope";
import { JOB_PRIORITY_LABEL, JOB_STATUS_LABEL, type Job } from "@/modules/jobs/core/job-fields";
import { JOB_COLUMNS, mapJob } from "@/modules/jobs/server/jobs-data";
import { calendarRange, EVENT_KIND_LABEL, formatOccurrence, remindLabel, vnDay, vnDayString, type CalendarPeriod } from "@/modules/calendar/core/calendar";
import { getMyReminderDefaults, listOccurrences, loadMembers, viewerFor } from "@/modules/calendar/server/calendar-data";
import { FACT_FIELDS, REC_OUTCOME_LABEL, REC_STEPS, normalizeFlow, type RecOutcome } from "@/modules/rec-flow/core/rec-flow";

// Round A tools for Trợ lý (and Soda on Zalo): job board, Luồng Rec candidates, KPI. Read only.
// bang_job reads with the member's session (RLS, "Job · Xem"). Candidate states and KPI counts are
// service-role tables, so the scope is applied here: candidates only on channel accounts the member
// may access; KPI only for the member and the people they manage, or everyone for administrators and
// members who may view roles.

type Scope = { workspaceId: string; userId: string; context: ActionContext };
type Row = Record<string, unknown>;

const DAY = 86_400_000;
const clip = (value: unknown, max = 200) => typeof value === "string" && value.trim() ? (value.length > max ? `${value.slice(0, max)}…` : value) : null;
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase();
const str = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const num = (value: unknown) => typeof value === "number" ? value : Number(value ?? 0) || 0;
const countBy = (values: string[]) => values.reduce<Record<string, number>>((acc, value) => { acc[value] = (acc[value] ?? 0) + 1; return acc; }, {});
const chunks = <T,>(items: T[], size = 150) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

function jobBrief(job: Job) {
  return {
    ma: job.code, vi_tri: job.title, huong_nghe: job.careerTrack, cong_ty: job.companyName,
    ...(job.companyNamePublic ? {} : { khong_noi_ten_cong_ty_voi_ung_vien: true }),
    dia_diem: job.location, hinh_thuc: job.workMode, tieng_nhat: job.japaneseLevelMin, kinh_nghiem: job.experienceMin, luong: job.salaryRange,
    diem_manh: clip(job.sellingPoints, 160), trang_thai: JOB_STATUS_LABEL[job.status], uu_tien: JOB_PRIORITY_LABEL[job.priority],
    phu_trach: job.ownerName, jd: job.jdLink,
  };
}

/** One member by (part of) their name, among those the asker may see. */
export function pickPerson(profiles: Row[], name: string | null, visible: (id: string) => boolean): { id: string; name: string } | { loi: string } | { nhieu_nguoi_trung_ten: unknown[]; goi_y: string } {
  if (!name) return { loi: "Cần tên người cần xem." };
  const wanted = fold(name);
  const found = profiles.filter((row) => fold(String(row.full_name ?? "")).includes(wanted));
  const exact = found.filter((row) => fold(String(row.full_name ?? "")) === wanted);
  const allowed = (exact.length === 1 ? exact : found).filter((row) => visible(String(row.id)));
  if (!found.length) return { loi: `Không có thành viên tên "${name}".` };
  if (!allowed.length) return { loi: "Sếp chỉ xem được của mình và cấp dưới." };
  if (allowed.length > 1) return { nhieu_nguoi_trung_ten: allowed.map((row) => row.full_name), goi_y: "Hỏi lại tên đầy đủ." };
  return { id: String(allowed[0].id), name: String(allowed[0].full_name ?? "") };
}

export const crmTools: Record<string, (args: Record<string, unknown>, scope: Scope) => Promise<unknown>> = {
  async bang_job(args, scope) {
    const supabase = await createClient();
    const [{ data, error }, { data: profiles }] = await Promise.all([
      supabase.from("recruitment_jobs").select(JOB_COLUMNS).eq("workspace_id", scope.workspaceId).order("updated_at", { ascending: false }).limit(2000),
      supabase.from("profiles").select("id,full_name").eq("workspace_id", scope.workspaceId),
    ]);
    if (error) return { loi: "Không tải được bảng job." };
    const owners = new Map(((profiles ?? []) as Row[]).map((row) => [String(row.id), String(row.full_name ?? "")]));
    const jobs = ((data ?? []) as Row[]).flatMap((row) => { const job = mapJob(row, owners); return job ? [job] : []; });
    const code = str(args.job_code);
    if (code) {
      const job = jobs.find((item) => item.code.toLowerCase() === code.toLowerCase());
      if (!job) return { loi: `Không có job mã ${code}.`, link: "/jobs" };
      return {
        ...jobBrief(job), diem_manh: job.sellingPoints, tom_tat: job.summary, yeu_cau: job.requirements,
        quy_trinh_phong_van: job.interviewProcess, ghi_chu_noi_bo: clip(job.note, 600), cap_nhat: job.updatedAt, link: "/jobs",
      };
    }
    const status = str(args.trang_thai) ?? "OPEN";
    const words = str(args.tu_khoa) ? fold(String(args.tu_khoa)).split(/\s+/u).filter(Boolean) : [];
    const matches = jobs.filter((job) => (status === "TAT_CA" || job.status === status) && words.every((word) => fold([job.code, job.title, job.careerTrack, job.companyName, job.location, job.workMode, job.japaneseLevelMin, job.experienceMin, job.salaryRange].filter(Boolean).join(" ")).includes(word)))
      .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "HIGH" ? -1 : 1) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const limit = typeof args.so_luong === "number" ? args.so_luong : 20;
    return {
      tong_khop: matches.length,
      theo_trang_thai: countBy(jobs.map((job) => JOB_STATUS_LABEL[job.status])),
      theo_huong_nghe: countBy(matches.map((job) => job.careerTrack)),
      job: matches.slice(0, limit).map(jobBrief),
      link: "/jobs",
    };
  },

  async ung_vien_rec(args, scope) {
    const db = createPrivilegedClient();
    const days = typeof args.so_ngay === "number" ? args.so_ngay : 30;
    let query = db.from("candidate_flow_states").select("id,contact_id,conversation_id,step,facts,offered_job_ids,rejected_jobs,outcome,updated_by,created_at,updated_at")
      .eq("workspace_id", scope.workspaceId).gte("updated_at", new Date(Date.now() - days * DAY).toISOString()).order("updated_at", { ascending: false }).limit(1000);
    if (typeof args.buoc === "number") query = query.eq("step", args.buoc);
    if (args.ket_qua === "DANG_TU_VAN") query = query.is("outcome", null);
    else if (typeof args.ket_qua === "string") query = query.eq("outcome", args.ket_qua);
    if (args.chi_cua_toi === true) query = query.eq("updated_by", scope.userId);
    const [{ data, error }, accessible] = await Promise.all([query, getAccessibleChannelAccountIds()]);
    if (error) return { loi: "Không tải được dữ liệu Luồng Rec." };
    const states = (data ?? []) as Row[];
    const conversationIds = [...new Set(states.flatMap((row) => typeof row.conversation_id === "string" ? [row.conversation_id] : []))];
    const contactIds = [...new Set(states.flatMap((row) => typeof row.contact_id === "string" ? [row.contact_id] : []))];
    const columns = "id,channel_account_id,channel_type,contact_id,metadata,last_message_at";
    const [byId, byContact, contacts] = await Promise.all([
      Promise.all(chunks(conversationIds).map((ids) => db.from("omnichannel_conversations").select(columns).eq("workspace_id", scope.workspaceId).in("id", ids))),
      Promise.all(chunks(contactIds).map((ids) => db.from("omnichannel_conversations").select(columns).eq("workspace_id", scope.workspaceId).in("contact_id", ids).order("last_message_at", { ascending: false }))),
      Promise.all(chunks(contactIds).map((ids) => db.from("contacts").select("id,full_name").eq("workspace_id", scope.workspaceId).in("id", ids))),
    ]);
    const visible = (row: Row) => accessible === null || accessible.includes(String(row.channel_account_id));
    const conversations = new Map(byId.flatMap((result) => (result.data ?? []) as Row[]).map((row) => [String(row.id), row]));
    const contactConversations = new Map<string, Row[]>();
    for (const row of byContact.flatMap((result) => (result.data ?? []) as Row[])) {
      const key = String(row.contact_id);
      contactConversations.set(key, [...(contactConversations.get(key) ?? []), row]);
    }
    const contactNames = new Map(contacts.flatMap((result) => (result.data ?? []) as Row[]).map((row) => [String(row.id), String(row.full_name ?? "")]));
    const words = str(args.tu_khoa) ? fold(String(args.tu_khoa)).split(/\s+/u).filter(Boolean) : [];
    const rows = states.flatMap((state) => {
      const own = typeof state.conversation_id === "string" ? conversations.get(state.conversation_id) : undefined;
      const options = [...(own ? [own] : []), ...(typeof state.contact_id === "string" ? contactConversations.get(state.contact_id) ?? [] : [])].filter(visible);
      if (!options.length) return [];
      const flow = normalizeFlow({ step: state.step, facts: state.facts, offeredJobIds: state.offered_job_ids, rejectedJobs: state.rejected_jobs, outcome: state.outcome });
      const name = (typeof state.contact_id === "string" ? contactNames.get(state.contact_id) : null) || metadataName(options[0].metadata) || "Ứng viên";
      const facts = Object.fromEntries(FACT_FIELDS.flatMap((field) => flow.facts[field.key] ? [[field.label, flow.facts[field.key] as string]] : []));
      if (words.length && !words.every((word) => fold(`${name} ${Object.values(facts).join(" ")}`).includes(word))) return [];
      return [{ state, flow, name, facts, conversation: options[0] }];
    });
    const jobIds = [...new Set(rows.slice(0, 30).flatMap((row) => [...row.flow.offeredJobIds, ...row.flow.rejectedJobs.map((job) => job.jobId)]))];
    const updaterIds = [...new Set(rows.slice(0, 30).flatMap((row) => typeof row.state.updated_by === "string" ? [row.state.updated_by] : []))];
    const [jobs, updaters] = await Promise.all([
      jobIds.length ? db.from("recruitment_jobs").select("id,code,title").eq("workspace_id", scope.workspaceId).in("id", jobIds) : Promise.resolve({ data: [] }),
      updaterIds.length ? db.from("profiles").select("id,full_name").eq("workspace_id", scope.workspaceId).in("id", updaterIds) : Promise.resolve({ data: [] }),
    ]);
    const jobNames = new Map(((jobs.data ?? []) as Row[]).map((row) => [String(row.id), `${row.code} ${row.title}`]));
    const people = new Map(((updaters.data ?? []) as Row[]).map((row) => [String(row.id), String(row.full_name ?? "")]));
    const stepLabel = (step: number) => `${step}. ${REC_STEPS[step - 1]?.label ?? ""}`;
    return {
      khoang: `${days} ngày gần đây`,
      tong: rows.length,
      theo_buoc: countBy(rows.map((row) => stepLabel(row.flow.step))),
      theo_ket_qua: countBy(rows.map((row) => row.flow.outcome ? REC_OUTCOME_LABEL[row.flow.outcome as RecOutcome] : "Đang tư vấn")),
      ung_vien: rows.slice(0, 30).map((row) => ({
        ten_khach_viet: row.name, kenh: row.conversation.channel_type, buoc: stepLabel(row.flow.step),
        ket_qua: row.flow.outcome ? REC_OUTCOME_LABEL[row.flow.outcome as RecOutcome] : "Đang tư vấn",
        thong_tin_khach_viet: row.facts,
        job_da_gioi_thieu: row.flow.offeredJobIds.map((id) => jobNames.get(id) ?? "job đã xoá"),
        job_tu_choi: row.flow.rejectedJobs.map((job) => ({ job: jobNames.get(job.jobId) ?? "job đã xoá", ly_do_khach_viet: job.reason })),
        cap_nhat_boi: typeof row.state.updated_by === "string" ? people.get(row.state.updated_by) ?? null : null,
        cap_nhat: row.state.updated_at, link: `/inbox/all/${row.conversation.id}`,
      })),
    };
  },

  async lich_hen(args, scope) {
    const range = calendarRange((args.ky as CalendarPeriod | null) ?? null, str(args.tu_ngay), str(args.den_ngay), Date.now());
    if ("error" in range) return { loi: range.error };
    const mode = str(args.pham_vi) ?? "TOI";
    let personIds: string[] | undefined;
    if (mode === "NGUOI") {
      const db = createPrivilegedClient();
      const [{ data: rows }, members] = await Promise.all([db.from("profiles").select("id,full_name,manager_id").eq("workspace_id", scope.workspaceId), loadMembers(db, scope.workspaceId)]);
      const viewer = viewerFor(scope.context, members);
      const person = pickPerson((rows ?? []) as Row[], str(args.ten_nguoi), (id) => viewer.seesAll || viewer.team.has(id));
      if ("loi" in person || "nhieu_nguoi_trung_ten" in person) return person;
      personIds = [person.id];
    }
    const result = await listOccurrences(scope.context, { from: range.from, to: range.to, scope: mode === "CONG_TY" ? "ALL" : mode === "TEAM" ? "TEAM" : "MINE", personIds });
    if (mode === "CONG_TY" && result.scope !== "ALL") return { loi: "Xem lịch cả công ty cần quyền xem Vai trò; sếp xem được lịch của mình và cấp dưới (TEAM)." };
    const { minutes } = await getMyReminderDefaults(scope.context);
    return {
      khoang: `${formatOccurrence(range.from, 0).split(",")[0]} – ${formatOccurrence(range.to - 1, 0).split(",")[0]}`,
      tong: result.occurrences.length,
      lich: result.occurrences.slice(0, 60).map((item) => ({
        id: item.eventId, tieu_de: item.title, loai: EVENT_KIND_LABEL[item.kind], thoi_gian: formatOccurrence(item.start, item.durationMinutes), lap_lai: item.repeat,
        dia_diem: item.location, ghi_chu: clip(item.note, 200), nguoi_tao: item.createdByName,
        nguoi_tham_gia: item.attendees.map((person) => person.declined ? `${person.name} (không tham gia)` : person.name),
        toi_tham_gia: item.isAttendee && !item.myDeclined, nhac_toi: item.isAttendee ? remindLabel(item.myRemindMinutes ?? minutes) : null,
        ...(item.conversationId ? { hoi_thoai: `/inbox/all/${item.conversationId}` } : {}),
      })),
      link: `/calendar?tuan=${vnDayString(vnDay(range.from))}`,
    };
  },

  async kpi(args, scope) {
    const range = kpiRange((args.ky as KpiPeriod | null) ?? null, str(args.tu_ngay), str(args.den_ngay));
    if ("error" in range) return { loi: range.error };
    const db = createPrivilegedClient();
    const { data: profileRows, error } = await db.from("profiles").select("id,full_name,manager_id").eq("workspace_id", scope.workspaceId);
    if (error) return { loi: "Không tải được danh sách thành viên." };
    const profiles = (profileRows ?? []) as Row[];
    const managers = profiles.map((row) => ({ id: String(row.id), managerId: typeof row.manager_id === "string" ? row.manager_id : null }));
    const team = teamOf(scope.userId, managers);
    const seesAll = scope.context.isAdmin || scope.context.permissions.includes("roles.view");
    const mode = str(args.pham_vi) ?? "TOI";
    let ids: string[];
    if (mode === "CONG_TY") {
      if (!seesAll) return { loi: "Sếp chỉ xem được KPI của mình và cấp dưới (pham_vi TEAM). KPI cả công ty cần quyền xem Vai trò." };
      ids = profiles.map((row) => String(row.id));
    } else if (mode === "NGUOI" || (mode === "TEAM" && str(args.ten_nguoi))) {
      const person = pickPerson(profiles, str(args.ten_nguoi), (id) => seesAll || team.has(id));
      if ("loi" in person || "nhieu_nguoi_trung_ten" in person) return person;
      // "team Hải": Hải and everyone below Hải.
      ids = mode === "TEAM" ? [...teamOf(person.id, managers)] : [person.id];
    } else ids = mode === "TEAM" ? [...team] : [scope.userId];
    const { data, error: rpcError } = await db.rpc("assistant_kpi_counts", { p_workspace_id: scope.workspaceId, p_profile_ids: ids, p_from: range.from.toISOString(), p_to: range.to.toISOString() });
    if (rpcError) return { loi: "Không tính được KPI." };
    const people = (Array.isArray(data) ? data : []) as Row[];
    const detailed = people.length <= 3;
    const result = people.map((person) => {
      const accounts = (Array.isArray(person.accounts) ? person.accounts : []) as Row[];
      const sum = (key: string) => accounts.reduce((total, account) => total + num(account[key]), 0);
      const sent = num(person.email_sent);
      return {
        ten: person.name,
        nick_phu_trach: accounts.length,
        tin_den: sum("inbound"), tin_di: sum("outbound"), hoi_thoai_co_tin_den: sum("conversations_in"), hoi_thoai_moi: sum("new_conversations"), nhom_moi: sum("new_groups"), dang_chua_doc: sum("unread"), nhom_chua_doc: sum("unread_groups"),
        tu_tay_gui: num(person.manual_sent),
        rec: { ung_vien_moi: num(person.rec_new), nhan_cv: num(person.rec_cv), ung_vien_da_xu_ly: num(person.rec_touched) },
        email_chien_dich: { da_gui: sent, phan_hoi: num(person.email_replied), ti_le_phan_hoi: sent ? `${(num(person.email_replied) / sent * 100).toFixed(1)}%` : null },
        content_da_tao: num(person.content_created),
        cong_viec: { dang_mo: num(person.tasks_open), qua_han: num(person.tasks_overdue), da_xong: num(person.tasks_completed) },
        ...(detailed ? { theo_nick: accounts.slice(0, 12).map((account) => ({ nick: account.name, kenh: account.channel, tin_den: account.inbound, tin_di: account.outbound, hoi_thoai_moi: account.new_conversations, nhom_moi: account.new_groups, dang_chua_doc: account.unread, nhom_chua_doc: account.unread_groups })) } : {}),
      };
    });
    const total = (pick: (row: (typeof result)[number]) => number) => result.reduce((acc, row) => acc + pick(row), 0);
    return {
      ky: range.label,
      pham_vi: mode,
      so_nguoi: result.length,
      ...(result.length > 1 ? { tong: { tin_den: total((row) => row.tin_den), tin_di: total((row) => row.tin_di), hoi_thoai_moi: total((row) => row.hoi_thoai_moi), tu_tay_gui: total((row) => row.tu_tay_gui), nhan_cv: total((row) => row.rec.nhan_cv), email_da_gui: total((row) => row.email_chien_dich.da_gui), email_phan_hoi: total((row) => row.email_chien_dich.phan_hoi), content_da_tao: total((row) => row.content_da_tao), cong_viec_qua_han: total((row) => row.cong_viec.qua_han) } } : {}),
      nguoi: result.sort((a, b) => b.tin_di + b.tu_tay_gui - (a.tin_di + a.tu_tay_gui)).slice(0, 40),
      cach_tinh: "Tin nhắn/hội thoại tính trên các nick người đó là Người dùng chính; tin đi gồm cả tin chiến dịch; hội thoại mới = khách 1-1 bắt đầu nhắn trong kỳ (nhóm tính riêng); đang chưa đọc = khách 1-1 (không tính email tự động, thư mục Khác; nhóm tính riêng), tính tới hiện tại; tự tay gửi = tin gửi tay qua HireX; Rec theo người cập nhật Luồng Rec; email theo hộp thư người đó là Người dùng chính; công việc theo người được giao (đang mở/quá hạn tính tới hiện tại).",
      link: "/analytics",
    };
  },
};
