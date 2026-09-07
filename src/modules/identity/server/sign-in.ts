"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { LoginState } from "@/modules/identity/types/login";

export async function signIn(_state: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    return { error: "INVALID_CREDENTIALS" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

  if (error) {
    return {
      error: error.code === "email_not_confirmed"
        ? "EMAIL_NOT_CONFIRMED"
        : error.code === "invalid_credentials"
          ? "INVALID_CREDENTIALS"
          : "UNAVAILABLE",
    };
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { error: "UNAVAILABLE" };

  redirect("/campaigns");
}
