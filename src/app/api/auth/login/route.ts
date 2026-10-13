import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appendFile, mkdir, stat, rename } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

// Deliberately exclude request bodies, identifiers, cookies and error messages.
async function diagnostic(id: string, started: number, stage: string, code?: string, status?: number) {
  const entry = JSON.stringify({ at: new Date().toISOString(), id, stage, elapsedMs: Date.now() - started,
    code: code && /^[a-zA-Z0-9_]{1,80}$/.test(code) ? code : undefined, status });
  console.info("[auth-login]", entry);
  try {
    const directory = join(process.cwd(), "runtime");
    const file = join(directory, "auth-login.jsonl");
    await mkdir(directory, { recursive: true });
    if ((await stat(file).catch(() => null))?.size && (await stat(file)).size > 1_000_000) {
      await rename(file, `${file}.previous`).catch(() => undefined);
    }
    await appendFile(file, `${entry}\n`, { mode: 0o600 });
  } catch { /* Diagnostics must never block authentication. */ }
}

type LoginError = "INVALID_CREDENTIALS" | "EMAIL_NOT_CONFIRMED" | "UNAVAILABLE";

export async function POST(request: NextRequest) {
  const id = crypto.randomUUID();
  const started = Date.now();
  await diagnostic(id, started, "received");
  const origin = request.headers.get("origin");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const expectedOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : request.nextUrl.origin;
  if (origin && origin !== expectedOrigin) {
    await diagnostic(id, started, "origin_rejected", undefined, 403);
    return NextResponse.json({ error: "UNAVAILABLE" satisfies LoginError }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" satisfies LoginError }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" satisfies LoginError }, { status: 400 });
  }
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password || email.length > 320 || password.length > 1024) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" satisfies LoginError }, { status: 400 });
  }

  try {
    await diagnostic(id, started, "auth_start");
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      await diagnostic(id, started, "auth_rejected", error.code, error.status);
      const code: LoginError = error.code === "email_not_confirmed"
        ? "EMAIL_NOT_CONFIRMED"
        : error.code === "invalid_credentials"
          ? "INVALID_CREDENTIALS"
          : "UNAVAILABLE";
      console.error("[auth-login] Supabase rejected login", { code: error.code, status: error.status });
      return NextResponse.json({ error: code }, { status: error.status === 429 ? 429 : 401 });
    }
    if (!data.user || !data.session) {
      await diagnostic(id, started, "session_missing");
      console.error("[auth-login] Supabase returned no session");
      return NextResponse.json({ error: "UNAVAILABLE" satisfies LoginError }, { status: 503 });
    }
    await diagnostic(id, started, "success", undefined, 200);
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    await diagnostic(id, started, "exception", error instanceof Error ? error.name : "UnknownError", 503);
    console.error("[auth-login] Request failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "UNAVAILABLE" satisfies LoginError }, { status: 503 });
  }
}
