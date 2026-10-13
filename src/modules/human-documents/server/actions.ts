"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceAdmin } from "@/modules/access/server/access-control";
import { verifyAndStoreHumanConnection } from "./connection";

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
