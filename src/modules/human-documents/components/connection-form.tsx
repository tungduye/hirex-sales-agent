"use client";

import { useActionState, useEffect, useRef } from "react";
import { saveHumanConnection } from "../server/actions";

export function HumanConnectionForm({ endpoint, username }: { endpoint: string | null; username: string }) {
  const [state, action, pending] = useActionState(saveHumanConnection, { message: "", ok: false });
  const password = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state.ok && password.current) password.current.value = ""; }, [state]);
  return <form action={action} className="mt-6 max-w-xl space-y-4">
    <p className="text-sm text-slate-600">Máy chủ Human: {endpoint ?? "Chưa cấu hình kết nối HTTPS an toàn"}</p>
    {!endpoint && <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Chưa nhập mật khẩu lúc này. Quản trị máy chủ cần cấu hình HUMAN_API_BASE_URL tới API Human có HTTPS hợp lệ. Địa chỉ HTTP hiện tại bị chặn.</p>}
    <fieldset disabled={!endpoint || pending} className="space-y-4 disabled:opacity-60">
      <label className="block text-sm">Email tài khoản Human<input name="username" type="email" required maxLength={254} defaultValue={username} autoComplete="off" className="mt-1 block w-full rounded-lg border p-3" /></label>
      <label className="block text-sm">Mật khẩu Human<input ref={password} name="password" type="password" required maxLength={1024} autoComplete="off" className="mt-1 block w-full rounded-lg border p-3" /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="consent" value="yes" required className="mt-1" />Tôi đồng ý gửi thông tin đăng nhập tới máy chủ Human ở trên để kiểm tra và lưu mã hóa trên máy chủ HireX.</label>
      <button className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50" type="submit">{pending ? "Đang kiểm tra…" : "Kiểm tra và lưu kết nối"}</button>
    </fieldset>
    <p role="status" aria-live="polite" className="text-sm">{state.message}</p>
  </form>;
}
