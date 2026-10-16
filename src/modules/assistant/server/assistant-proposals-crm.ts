import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { parseVietnamDue } from "@/modules/assistant/core/assistant-tools";
import { changedFields, type FieldChange } from "@/modules/assistant/core/crm-changes";
import type { ActionContext, Built, Executed } from "@/modules/assistant/server/assistant-proposals";

// Phase 3 proposals for Liên hệ, Công ty and Công việc. Same contract as assistant-proposals.ts:
// a proposal is checked against current data and shown as a card (old → new); nothing changes until
// the member presses "Xác nhận". Writes go through the member's own session, so the database's
// permission rules (RLS) apply exactly as for the buttons in the web app. Nothing here deletes data.

type Row = Record<string, unknown>;
const LEAD_LABELS: Record<string, string> = { NEW: "Mới", CONTACTED: "Đã liên hệ", ENGAGED: "Đang trao đổi", QUALIFIED: "Đủ điều kiện", OPPORTUNITY: "Cơ hội", WON: "Thành công", LOST: "Thất bại", DO_NOT_CONTACT: "Không liên hệ" };
const COMPANY_LABELS: Record<string, string> = { ACTIVE: "Đang hợp tác", PROSPECT: "Tiềm năng", INACTIVE: "Ngừng" };
const TASK_LABELS: Record<string, string> = { OPEN: "Đang mở", IN_PROGRESS: "Đang làm", COMPLETED: "Hoàn thành", CANCELLED: "Huỷ" };
const vnTime = (iso: string) => new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
const text = (value: unknown) => typeof value === "string" ? value.trim() : null;
const safeLike = (value: string) => value.replace(/[%_,()\\]/g, " ").trim();
const email = z.string().trim().max(320).pipe(z.email());
const lines = (changes: FieldChange[]) => changes.map((change) => `${change.label}: ${change.before ?? "(trống)"} → ${change.after ?? "(xoá)"}`);

/** One company by name (exact first, then contains). */
async function findCompany(context: ActionContext, name: string): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const { data } = await (await createClient()).from("companies").select("id,name").eq("workspace_id", context.workspaceId).ilike("name", `%${safeLike(name)}%`).limit(6);
  const rows = (data ?? []) as Row[];
  const exact = rows.filter((row) => String(row.name).toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"));
  const pick = exact.length === 1 ? exact : rows;
  if (!pick.length) return { ok: false, error: `Chưa có công ty "${name}". Đề xuất tạo công ty trước (de_xuat_tao_cong_ty) nếu người dùng muốn.` };
  if (pick.length > 1) return { ok: false, error: `Có nhiều công ty khớp: ${pick.map((row) => row.name).join(", ")}. Hỏi lại người dùng chọn công ty nào.` };
  return { ok: true, id: String(pick[0].id), name: String(pick[0].name) };
}

/** One member by name (same matching as task assignment). */
async function findMember(context: ActionContext, name: string): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const { data } = await createPrivilegedClient().from("profiles").select("id,full_name").eq("workspace_id", context.workspaceId).ilike("full_name", `%${safeLike(name)}%`).limit(6);
  const rows = (data ?? []) as Row[];
  const exact = rows.filter((row) => String(row.full_name).toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"));
  const pick = exact.length === 1 ? exact : rows;
  if (!pick.length) return { ok: false, error: `Không tìm thấy thành viên tên "${name}".` };
  if (pick.length > 1) return { ok: false, error: `Có nhiều thành viên khớp: ${pick.map((row) => row.full_name).join(", ")}. Hỏi lại người dùng muốn chọn ai.` };
  return { ok: true, id: String(pick[0].id), name: String(pick[0].full_name) };
}

// ---------------------------------------------------------------------------------------------
// Liên hệ
// ---------------------------------------------------------------------------------------------

export async function proposeCreateContact(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const fullName = text(args.ho_ten);
  if (!fullName) return { ok: false, error: "Thiếu họ tên." };
  const mail = text(args.email) || null;
  if (mail && !email.safeParse(mail).success) return { ok: false, error: "Email không hợp lệ." };
  const phone = text(args.sdt) || null;
  const supabase = await createClient();
  // The same person twice makes campaigns message them twice: refuse a duplicate email, warn on phone.
  if (mail) {
    const { data } = await supabase.from("contacts").select("id,full_name").eq("workspace_id", context.workspaceId).ilike("email", safeLike(mail)).limit(1);
    if (data?.length) return { ok: false, error: `Đã có liên hệ ${data[0].full_name} dùng email này (id ${data[0].id}). Không tạo thẻ nào khác: báo người dùng liên hệ đã có (link /contacts/${data[0].id}) và hỏi họ muốn làm gì.` };
  }
  let warning: string | null = null;
  if (phone) {
    const { data } = await supabase.from("contacts").select("full_name").eq("workspace_id", context.workspaceId).eq("phone", phone).limit(1);
    if (data?.length) warning = `Số điện thoại này đã có ở liên hệ ${data[0].full_name}. Kiểm tra có trùng người không trước khi xác nhận.`;
  }
  let company: { id: string; name: string } | null = null;
  if (text(args.cong_ty)) {
    const found = await findCompany(context, String(text(args.cong_ty)));
    if (!found.ok) return found;
    company = found;
  }
  const leadStatus = typeof args.trang_thai_lead === "string" ? args.trang_thai_lead : "NEW";
  const params = { fullName, email: mail, phone, jobTitle: text(args.chuc_danh) || null, country: text(args.quoc_gia) || null, source: text(args.nguon) || "Trợ lý HireX", leadStatus, companyId: company?.id ?? null };
  return {
    ok: true, kind: "CREATE_CONTACT", params,
    preview: {
      title: "Tạo liên hệ",
      lines: [
        `Họ tên: ${fullName}`, ...(params.jobTitle ? [`Chức danh: ${params.jobTitle}`] : []), ...(company ? [`Công ty: ${company.name}`] : []),
        ...(mail ? [`Email: ${mail}`] : []), ...(phone ? [`SĐT: ${phone}`] : []), ...(params.country ? [`Quốc gia: ${params.country}`] : []),
        `Trạng thái lead: ${LEAD_LABELS[leadStatus] ?? leadStatus}`, `Nguồn: ${params.source}`,
      ],
      warning, link: "/contacts",
    },
  };
}

export async function executeCreateContact(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const { data, error } = await (await createClient()).from("contacts").insert({
    workspace_id: context.workspaceId, full_name: params.fullName, email: params.email, phone: params.phone, job_title: params.jobTitle,
    country: params.country, source: params.source, lead_status: params.leadStatus, company_id: params.companyId, lead_score: 0,
  }).select("id").single();
  if (error || !data) return { ok: false, message: "Không tạo được liên hệ (có thể thiếu quyền Tạo liên hệ)." };
  revalidatePath("/contacts");
  return { ok: true, message: `Đã tạo liên hệ ${String(params.fullName)}.`, link: `/contacts/${data.id}` };
}

const CONTACT_FIELDS = [
  { arg: "ho_ten", column: "full_name", label: "Họ tên", required: true },
  { arg: "chuc_danh", column: "job_title", label: "Chức danh" },
  { arg: "email", column: "email", label: "Email" },
  { arg: "sdt", column: "phone", label: "SĐT" },
  { arg: "quoc_gia", column: "country", label: "Quốc gia" },
  { arg: "ngon_ngu", column: "language", label: "Ngôn ngữ" },
  { arg: "nguon", column: "source", label: "Nguồn" },
] as const;

export async function proposeUpdateContact(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const { data: contact } = await (await createClient()).from("contacts").select("id,full_name,job_title,email,phone,country,language,source,company_id,lead_score,updated_at,companies(name)")
    .eq("workspace_id", context.workspaceId).eq("id", String(args.contact_id)).maybeSingle();
  if (!contact) return { ok: false, error: "Không tìm thấy liên hệ." };
  const row = contact as Row;
  const changes = changedFields(row, args, CONTACT_FIELDS);
  if ("error" in changes) return { ok: false, error: changes.error };
  const mail = changes.list.find((change) => change.column === "email")?.after;
  if (mail && !email.safeParse(mail).success) return { ok: false, error: "Email mới không hợp lệ." };
  const update: Record<string, unknown> = Object.fromEntries(changes.list.map((change) => [change.column, change.after]));
  const list = [...changes.list];
  if (text(args.cong_ty)) {
    const found = await findCompany(context, String(text(args.cong_ty)));
    if (!found.ok) return found;
    if (found.id !== row.company_id) {
      const current = Array.isArray(row.companies) ? row.companies[0] : row.companies;
      list.push({ column: "company_id", label: "Công ty", before: (current as Row | null)?.name as string ?? null, after: found.name });
      update.company_id = found.id;
    }
  }
  if (typeof args.diem_lead === "number" && args.diem_lead !== row.lead_score) {
    list.push({ column: "lead_score", label: "Điểm lead", before: String(row.lead_score), after: String(args.diem_lead) });
    update.lead_score = args.diem_lead;
  }
  if (!list.length) return { ok: false, error: "Không có thông tin nào thay đổi so với hiện tại." };
  return {
    ok: true, kind: "UPDATE_CONTACT",
    params: { contactId: row.id, update, updatedAt: row.updated_at },
    preview: { title: `Sửa liên hệ ${String(row.full_name)}`, lines: lines(list), link: `/contacts/${row.id}` },
  };
}

export async function executeUpdateContact(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  // Only if nobody changed the contact since the card was made (otherwise the card would be stale).
  const { data, error } = await (await createClient()).from("contacts").update(params.update as Record<string, unknown>)
    .eq("workspace_id", context.workspaceId).eq("id", String(params.contactId)).eq("updated_at", String(params.updatedAt)).select("id,full_name");
  if (error) return { ok: false, message: "Không sửa được liên hệ (có thể thiếu quyền Sửa liên hệ)." };
  if (!data?.length) return { ok: false, message: "Liên hệ vừa được người khác sửa. Hãy hỏi lại để xem thông tin mới." };
  revalidatePath("/contacts");
  return { ok: true, message: `Đã cập nhật ${data[0].full_name}.`, link: `/contacts/${params.contactId}` };
}

export async function proposeNote(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const content = text(args.noi_dung);
  if (!content) return { ok: false, error: "Ghi chú trống." };
  const { data: contact } = await (await createClient()).from("contacts").select("id,full_name").eq("workspace_id", context.workspaceId).eq("id", String(args.contact_id)).maybeSingle();
  if (!contact) return { ok: false, error: "Không tìm thấy liên hệ." };
  return {
    ok: true, kind: "ADD_NOTE",
    params: { contactId: contact.id, content },
    preview: { title: `Thêm ghi chú cho ${contact.full_name}`, lines: [], editableText: content, editableKind: "note", link: `/contacts/${contact.id}` },
  };
}

export async function executeNote(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const content = String(params.content ?? "").trim().slice(0, 5000);
  if (!content) return { ok: false, message: "Ghi chú trống." };
  // The member must still be able to see the contact.
  const { data: contact } = await (await createClient()).from("contacts").select("id").eq("workspace_id", context.workspaceId).eq("id", String(params.contactId)).maybeSingle();
  if (!contact) return { ok: false, message: "Không còn quyền với liên hệ này." };
  const { error } = await createPrivilegedClient().from("notes").insert({ workspace_id: context.workspaceId, contact_id: contact.id, content, created_by: context.userId });
  if (error) return { ok: false, message: "Không lưu được ghi chú." };
  revalidatePath(`/contacts/${contact.id}`);
  return { ok: true, message: "Đã lưu ghi chú.", link: `/contacts/${contact.id}` };
}

// ---------------------------------------------------------------------------------------------
// Công ty
// ---------------------------------------------------------------------------------------------

export async function proposeCreateCompany(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const name = text(args.ten);
  if (!name) return { ok: false, error: "Thiếu tên công ty." };
  const website = text(args.website) || null;
  const supabase = await createClient();
  const { data: sameName } = await supabase.from("companies").select("id,name").eq("workspace_id", context.workspaceId).ilike("name", safeLike(name)).limit(1);
  if (sameName?.length) return { ok: false, error: `Đã có công ty ${sameName[0].name} (id ${sameName[0].id}).` };
  if (website) {
    const { data: sameSite } = await supabase.from("companies").select("name").eq("workspace_id", context.workspaceId).ilike("website", `%${safeLike(website.replace(/^https?:\/\//, "").replace(/\/$/, ""))}%`).limit(1);
    if (sameSite?.length) return { ok: false, error: `Website này đã thuộc công ty ${sameSite[0].name}.` };
  }
  const status = typeof args.trang_thai === "string" ? args.trang_thai : "PROSPECT";
  const params = { name, website, industry: text(args.nganh) || null, country: text(args.quoc_gia) || null, status };
  return {
    ok: true, kind: "CREATE_COMPANY", params,
    preview: {
      title: "Tạo công ty",
      lines: [`Tên: ${name}`, ...(website ? [`Website: ${website}`] : []), ...(params.industry ? [`Ngành: ${params.industry}`] : []), ...(params.country ? [`Quốc gia: ${params.country}`] : []), `Trạng thái: ${COMPANY_LABELS[status] ?? status}`],
      link: "/companies",
    },
  };
}

export async function executeCreateCompany(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const { error } = await (await createClient()).from("companies").insert({ workspace_id: context.workspaceId, name: params.name, website: params.website, industry: params.industry, country: params.country, status: params.status });
  if (error) return { ok: false, message: "Không tạo được công ty (có thể thiếu quyền Tạo công ty hoặc tên đã tồn tại)." };
  revalidatePath("/companies");
  return { ok: true, message: `Đã tạo công ty ${String(params.name)}.`, link: "/companies" };
}

const COMPANY_FIELDS = [
  { arg: "ten", column: "name", label: "Tên", required: true },
  { arg: "website", column: "website", label: "Website" },
  { arg: "nganh", column: "industry", label: "Ngành" },
  { arg: "quoc_gia", column: "country", label: "Quốc gia" },
] as const;

export async function proposeUpdateCompany(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const { data: company } = await (await createClient()).from("companies").select("id,name,website,industry,country,status,updated_at").eq("workspace_id", context.workspaceId).eq("id", String(args.company_id)).maybeSingle();
  if (!company) return { ok: false, error: "Không tìm thấy công ty." };
  const row = company as Row;
  const changes = changedFields(row, args, COMPANY_FIELDS);
  if ("error" in changes) return { ok: false, error: changes.error };
  const list = [...changes.list];
  const update: Record<string, unknown> = Object.fromEntries(list.map((change) => [change.column, change.after]));
  if (typeof args.trang_thai === "string" && args.trang_thai !== row.status) {
    list.push({ column: "status", label: "Trạng thái", before: COMPANY_LABELS[String(row.status)] ?? String(row.status), after: COMPANY_LABELS[args.trang_thai] ?? args.trang_thai });
    update.status = args.trang_thai;
  }
  if (!list.length) return { ok: false, error: "Không có thông tin nào thay đổi so với hiện tại." };
  return { ok: true, kind: "UPDATE_COMPANY", params: { companyId: row.id, update, updatedAt: row.updated_at }, preview: { title: `Sửa công ty ${String(row.name)}`, lines: lines(list), link: "/companies" } };
}

export async function executeUpdateCompany(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const { data, error } = await (await createClient()).from("companies").update(params.update as Record<string, unknown>)
    .eq("workspace_id", context.workspaceId).eq("id", String(params.companyId)).eq("updated_at", String(params.updatedAt)).select("id,name");
  if (error) return { ok: false, message: "Không sửa được công ty (có thể thiếu quyền Sửa công ty)." };
  if (!data?.length) return { ok: false, message: "Công ty vừa được người khác sửa. Hãy hỏi lại để xem thông tin mới." };
  revalidatePath("/companies");
  return { ok: true, message: `Đã cập nhật ${data[0].name}.`, link: "/companies" };
}

// ---------------------------------------------------------------------------------------------
// Công việc
// ---------------------------------------------------------------------------------------------

export async function proposeUpdateTask(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const { data: task } = await (await createClient()).from("channel_tasks").select("id,title,status,due_at,assigned_to,conversation_id,updated_at")
    .eq("workspace_id", context.workspaceId).eq("id", String(args.task_id)).maybeSingle();
  if (!task) return { ok: false, error: "Không tìm thấy công việc (lấy id từ công cụ cong_viec)." };
  const row = task as Row;
  const update: Record<string, unknown> = {};
  const list: string[] = [];
  const title = text(args.tieu_de);
  if (title && title !== row.title) { update.title = title; list.push(`Tiêu đề: ${String(row.title)} → ${title}`); }
  if (typeof args.trang_thai === "string" && args.trang_thai !== row.status) {
    update.status = args.trang_thai;
    list.push(`Trạng thái: ${TASK_LABELS[String(row.status)] ?? row.status} → ${TASK_LABELS[args.trang_thai] ?? args.trang_thai}`);
  }
  if (typeof args.han === "string") {
    const clear = args.han.trim() === "" || args.han.trim().toLowerCase() === "khong";
    const due = clear ? null : parseVietnamDue(args.han);
    if (!clear && !due) return { ok: false, error: "Hạn không hợp lệ, cần dạng YYYY-MM-DD hoặc YYYY-MM-DD HH:mm." };
    if (due !== row.due_at && !(due && row.due_at && Date.parse(due) === Date.parse(String(row.due_at)))) {
      update.due_at = due;
      list.push(`Hạn: ${row.due_at ? vnTime(String(row.due_at)) : "không có"} → ${due ? vnTime(due) : "không có"}`);
    }
  }
  if (text(args.giao_cho)) {
    const member = await findMember(context, String(text(args.giao_cho)));
    if (!member.ok) return member;
    if (member.id !== row.assigned_to) { update.assigned_to = member.id; list.push(`Giao cho: → ${member.name}`); }
  }
  if (!list.length) return { ok: false, error: "Không có thay đổi nào so với hiện tại." };
  return {
    ok: true, kind: "UPDATE_TASK",
    params: { taskId: row.id, update, updatedAt: row.updated_at },
    preview: { title: `Cập nhật công việc “${String(row.title).slice(0, 80)}”`, lines: list, link: row.conversation_id ? `/inbox/all/${row.conversation_id}` : "/tasks" },
  };
}

export async function executeUpdateTask(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  // Visible to the member (their session), then written by the server like the inbox task buttons.
  const { data: visible } = await (await createClient()).from("channel_tasks").select("id").eq("workspace_id", context.workspaceId).eq("id", String(params.taskId)).maybeSingle();
  if (!visible) return { ok: false, message: "Không còn quyền với công việc này." };
  const { data, error } = await createPrivilegedClient().from("channel_tasks").update(params.update as Record<string, unknown>)
    .eq("workspace_id", context.workspaceId).eq("id", String(params.taskId)).eq("updated_at", String(params.updatedAt)).select("id,title");
  if (error) return { ok: false, message: "Không cập nhật được công việc." };
  if (!data?.length) return { ok: false, message: "Công việc vừa được người khác sửa. Hãy hỏi lại để xem thông tin mới." };
  revalidatePath("/tasks");
  return { ok: true, message: `Đã cập nhật công việc “${String(data[0].title).slice(0, 80)}”.`, link: "/tasks" };
}
