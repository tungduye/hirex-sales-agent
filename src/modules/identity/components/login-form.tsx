"use client";

import { useActionState } from "react";
import { AlertCircle, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signIn } from "@/modules/identity/server/sign-in";
import { initialLoginState } from "@/modules/identity/types/login";

const errorMessages = {
  INVALID_CREDENTIALS: "Invalid email or password.",
  EMAIL_NOT_CONFIRMED: "Email is not confirmed.",
  UNAVAILABLE: "Unable to sign in. Please try again.",
} as const;

export function LoginForm() {
  const [state, formAction, isSubmitting] = useActionState(signIn, initialLoginState);
  const errorMessage = state.error ? errorMessages[state.error] : null;

  return (
    <form className="mt-7 space-y-5" action={formAction}>
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-700" htmlFor="email">Email</label>
        <div className="relative"><Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input id="email" name="email" type="email" autoComplete="email" required disabled={isSubmitting} className="h-11 w-full rounded-lg border bg-slate-50 pl-10 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60" placeholder="you@company.com" /></div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-700" htmlFor="password">Password</label>
        <div className="relative"><LockKeyhole className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input id="password" name="password" type="password" autoComplete="current-password" required disabled={isSubmitting} className="h-11 w-full rounded-lg border bg-slate-50 pl-10 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60" placeholder="Enter your password" /></div>
      </div>
      {errorMessage && <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-5 text-rose-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{errorMessage}</div>}
      <Button className="h-11 w-full" type="submit" disabled={isSubmitting}>{isSubmitting ? <><LoaderCircle className="size-4 animate-spin" />Signing in...</> : "Sign in"}</Button>
    </form>
  );
}
