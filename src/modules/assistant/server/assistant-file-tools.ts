import "server-only";

import { createClient } from "@/lib/supabase/server";
import { jdMarkdown } from "@/modules/documents-out/core/jd";
import { storeGeneratedDocx, writeDocumentMarkdown, type GeneratedFile } from "@/modules/documents-out/server/generated-files";
import { JOB_COLUMNS, mapJob } from "@/modules/jobs/server/jobs-data";
import type { ActionContext } from "@/modules/assistant/server/assistant-proposals";

// "tao_file_word": a Word file for the member who asked. The file is theirs only (and administrators');
// on Zalo the Trợ lý nick sends it into the chat after the answer.

export type FileScope = { workspaceId: string; userId: string; context: ActionContext; files?: GeneratedFile[]; channel?: "WEB" | "ZALO" };
export const MAX_FILES_PER_QUESTION = 3;

export const fileTools: Record<string, (args: Record<string, unknown>, scope: FileScope) => Promise<unknown>> = {
  async tao_file_word(args, scope) {
    const files = scope.files ?? [];
    if (files.length >= MAX_FILES_PER_QUESTION) return { loi: `Tối đa ${MAX_FILES_PER_QUESTION} file mỗi câu hỏi.` };
    const title = String(args.tieu_de).trim();
    const context = { workspaceId: scope.workspaceId, userId: scope.userId, isAdmin: scope.context.isAdmin };
    const source = scope.channel ?? "WEB";
    let file: GeneratedFile;
    try {
      if (args.loai === "JD") {
        if (!scope.context.isAdmin && !scope.context.permissions.includes("jobs.view")) return { loi: "Sếp chưa có quyền xem Job nên chưa tạo được JD." };
        const code = typeof args.job_code === "string" ? args.job_code.trim() : "";
        if (!code) return { loi: "Cần mã job (tra bằng bang_job)." };
        const supabase = await createClient();
        const { data } = await supabase.from("recruitment_jobs").select(JOB_COLUMNS).eq("workspace_id", scope.workspaceId).ilike("code", code).limit(1).maybeSingle();
        const job = data ? mapJob(data as Record<string, unknown>, new Map()) : null;
        if (!job) return { loi: `Không có job mã ${code}.` };
        const hideCompany = typeof args.an_ten_cong_ty === "boolean" ? args.an_ten_cong_ty : !job.companyNamePublic;
        const note = typeof args.yeu_cau === "string" && args.yeu_cau.trim() ? `\n\n## Ghi chú\n\n${args.yeu_cau.trim()}` : "";
        file = await storeGeneratedDocx(context, { kind: "JD", title: title || `JD ${job.title}`, markdown: jdMarkdown(job, { hideCompany, contact: null }) + note, subtitle: `JD · ${job.code}`, jobId: job.id, source });
      } else {
        const request = String(args.yeu_cau ?? "").trim();
        if (request.length < 5) return { loi: "Cần mô tả tài liệu muốn viết (yeu_cau)." };
        const markdown = await writeDocumentMarkdown({ title, request, data: typeof args.du_lieu === "string" ? args.du_lieu : null });
        file = await storeGeneratedDocx(context, { kind: "FREE", title, markdown, subtitle: "Tài liệu", source });
      }
    } catch {
      return { loi: "Chưa tạo được file, thử lại sau ít phút." };
    }
    files.push(file);
    scope.files = files;
    return {
      da_tao_file: true, ten_file: file.filename, link: file.link, trang_tai_lieu: "/assistant/files",
      ghi_chu: source === "ZALO" ? "Soda sẽ gửi file này vào chat ngay sau câu trả lời; chỉ cần nói ngắn là đã gửi file." : "Đưa link tải cho người dùng.",
    };
  },
};
