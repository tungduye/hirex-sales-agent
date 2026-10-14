"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceAdmin } from "@/modules/access/server/access-control";
import { verifyAndStoreHumanConnection } from "./connection";
import { storeHumanApiToken, syncHumanApi } from "./api-sync";

export async function saveHumanApiToken(_previous: { message: string; ok: boolean }, form: FormData) {
  const account = await requireWorkspaceAdmin();
  if (form.get("consent") !== "yes") return { ok: false, message: "Cần xác nhận sử dụng HTTP cho máy chủ lab Human." };
  try {
    await storeHumanApiToken(account.workspaceId, String(form.get("token") ?? "").trim().replace(/^Bearer\s+/i, ""));
    return { ok: true, message: "Đã lưu token mã hóa. Anh có thể cập nhật tài liệu từ Human." };
  } catch { return { ok: false, message: "Không lưu được token. Kiểm tra định dạng và cấu hình mã hóa máy chủ." }; }
}
export async function refreshHumanDocuments() {
  const account = await requireWorkspaceAdmin();
  try {
    const count = await syncHumanApi(account.workspaceId);
    revalidatePath("/documents");
    return { ok: true, message: `Đã cập nhật ${count.toLocaleString("vi-VN")} tài liệu từ Human.` };
  } catch { return { ok: false, message: "Chưa cập nhật được: kiểm tra token đã lưu, hạn đăng nhập và kết nối Human. Dữ liệu cũ được giữ nguyên." }; }
}

export async function saveHumanConnection(_previous: { message: string; ok: boolean }, form: FormData) {
  await requireWorkspaceAdmin();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!username || username.length > 254 || !password || password.length > 1024 || form.get("consent") !== "yes") {
    return { ok: false, message: "Nhập tài khoản, mật khẩu và xác nhận kiểm tra kết nối." };
  }
  try {
    await verifyAndStoreHumanConnection(username, password);
    revalidatePath("/settings/human");
    return { ok: true, message: "Đã xác thực và lưu kết nối mã hóa. Chưa đồng bộ tài liệu." };
  } catch {
    return { ok: false, message: "Chưa lưu được kết nối. Kiểm tra địa chỉ HTTPS, tài khoản Human hoặc cấu hình mã hóa trên máy chủ. Không có tài liệu nào bị thay đổi." };
  }
}
