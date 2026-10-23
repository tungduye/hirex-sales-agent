import { NextResponse } from "next/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { hasPermission } from "@/modules/access/server/access-control";
import { AUDIENCE_ROW_LIMIT, prepareAudience } from "@/modules/campaigns/domain/audience-import";
import { parseCampaignCsv } from "@/modules/campaigns/domain/campaign-rules";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

// A recipient file attached in the Trợ lý HireX panel. Read with the same reader and rules as the
// audience import of the email campaign page (CSV/XLSX, ≤ 5 MB, ≤ 20.000 rows, email column
// required, duplicates/invalid emails/suppressed addresses removed). Stored for 24 hours for this
// member only; the assistant model only ever sees the counts and column names.

const ERRORS: Record<string, string> = {
  EMPTY_FILE: "File trống.", ROW_LIMIT: `File quá ${AUDIENCE_ROW_LIMIT.toLocaleString("vi-VN")} dòng.`, COLUMN_LIMIT: "File quá 100 cột.",
  MISSING_EMAIL: "File cần có cột email (ví dụ: email, e-mail, địa chỉ email).", DUPLICATE_HEADERS: "File có tên cột bị trùng.",
  IMPORT_TOO_LARGE: "File quá lớn.", NO_RECIPIENTS: "Không còn người nhận hợp lệ sau khi loại email sai, trùng và bị chặn.",
};

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && !/:\/\/app2?\.hirexmkt\.online$/.test(origin)) return NextResponse.json({ ok: false, message: "Không được phép." }, { status: 403 });
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return NextResponse.json({ ok: false, message: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
  if (!await hasPermission("campaigns.create")) return NextResponse.json({ ok: false, message: "Tài khoản chưa có quyền tạo chiến dịch nên chưa đính kèm danh sách được." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ ok: false, message: "Chưa chọn file." }, { status: 400 });
  if (file.size > 5_000_000) return NextResponse.json({ ok: false, message: "File tối đa 5 MB." }, { status: 400 });
  if (!/\.(xlsx|csv)$/i.test(file.name)) return NextResponse.json({ ok: false, message: "Chỉ nhận file .csv hoặc .xlsx." }, { status: 400 });

  let prepared: ReturnType<typeof prepareAudience>;
  let columns: string[] = [];
  try {
    const rows = file.name.toLowerCase().endsWith(".xlsx")
      ? await (await import("read-excel-file/node")).readSheet(Buffer.from(await file.arrayBuffer()), 1)
      : parseCampaignCsv(await file.text(), AUDIENCE_ROW_LIMIT);
    columns = (rows[0] ?? []).map((value) => String(value ?? "").replace(/^﻿/, "").trim()).filter(Boolean).slice(0, 40);
    prepared = prepareAudience(rows as unknown[][]);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json({ ok: false, message: ERRORS[code] ?? "Không đọc được file. Kiểm tra định dạng CSV/XLSX." }, { status: 400 });
  }

  // Suppressed addresses (unsubscribed, bounced, blocked) never enter a campaign.
  const db = createPrivilegedClient();
  const blocked = new Set<string>();
  const cleaned = prepared.recipients as Array<{ email: string; normalized_email: string; display_name: string | null; company: string | null; position: string | null; personalization_json: Record<string, string> }>;
  const emails = cleaned.map((row) => row.email);
  for (let offset = 0; offset < emails.length; offset += 500) {
    const { data, error } = await db.from("email_suppressions").select("normalized_email").eq("workspace_id", account.workspaceId).in("normalized_email", emails.slice(offset, offset + 500));
    if (error) return NextResponse.json({ ok: false, message: "Chưa kiểm tra được danh sách chặn, thử lại sau." }, { status: 502 });
    for (const row of data ?? []) blocked.add(String(row.normalized_email));
  }
  const recipients = cleaned.filter((row) => !blocked.has(row.email));
  if (!recipients.length) return NextResponse.json({ ok: false, message: ERRORS.NO_RECIPIENTS }, { status: 400 });
  const stats = { sourceRows: prepared.sourceRows, invalidEmailRows: prepared.invalidEmailRows, duplicateRows: prepared.duplicateRows, suppressedRows: blocked.size, recipients: recipients.length };
  const fileName = file.name.normalize("NFKC").slice(0, 200);
  const { data, error } = await db.from("assistant_uploads").insert({ workspace_id: account.workspaceId, user_id: account.userId, file_name: fileName, recipients, stats, columns }).select("id").single();
  if (error || !data) return NextResponse.json({ ok: false, message: "Chưa lưu được file, thử lại sau." }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id, fileName, stats, columns }, { headers: { "Cache-Control": "no-store" } });
}
