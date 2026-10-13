"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LoginState } from "@/modules/identity/types/login";

const errorMessages = {
  INVALID_CREDENTIALS: "Email hoặc mật khẩu không đúng.",
  EMAIL_NOT_CONFIRMED: "Email chưa được xác nhận.",
  UNAVAILABLE: "Không thể đăng nhập. Vui lòng thử lại.",
} as const;

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<LoginState["error"]>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const errorMessage = error ? errorMessages[error] : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const form = new FormData(event.currentTarget);
    const email = form.get("email");
    const password = form.get("password");
    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      setError("INVALID_CREDENTIALS");
      setIsSubmitting(false);
      return;
    }
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json() as { ok?: unknown; error?: unknown };
      if (!response.ok || result.ok !== true) {
        setError(result.error === "EMAIL_NOT_CONFIRMED" ? "EMAIL_NOT_CONFIRMED" : result.error === "INVALID_CREDENTIALS" ? "INVALID_CREDENTIALS" : "UNAVAILABLE");
        setIsSubmitting(false);
        return;
      }
      router.replace("/campaigns");
      router.refresh();
    } catch {
      setError("UNAVAILABLE");
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-700" htmlFor="email">Email</label>
        <div className="relative"><Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input id="email" name="email" type="email" autoComplete="email" required disabled={isSubmitting} className="h-11 w-full rounded-lg border bg-slate-50 pl-10 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60" placeholder="you@company.com" /></div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-700" htmlFor="password">Mật khẩu</label>
        <div className="relative"><LockKeyhole className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input id="password" name="password" type="password" autoComplete="current-password" required disabled={isSubmitting} className="h-11 w-full rounded-lg border bg-slate-50 pl-10 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60" placeholder="Nhập mật khẩu" /></div>
      </div>
      {errorMessage && <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-5 text-rose-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{errorMessage}</div>}
      <Button className="h-11 w-full" type="submit" disabled={isSubmitting}>{isSubmitting ? <><LoaderCircle className="size-4 animate-spin" />Đang đăng nhập...</> : "Đăng nhập"}</Button>
    </form>
  );
}
