import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";
import { createPrivilegedClient } from "@/lib/supabase/privileged";

/**
 * Lets server code run "as" one member when there is no browser session, so every check the web app
 * already makes (row security, channel-account scope, permissions) applies unchanged. Used only by the
 * Zalo Trợ lý worker, for the member who sent the question from their own linked Zalo.
 */
type Jar = Array<{ name: string; value: string }>;
const store = new AsyncLocalStorage<{ jar: Jar }>();
const sessions = new Map<string, { accessToken: string; refreshToken: string; expiresAt: number }>();

/** The cookie jar of the member being acted for, or null in a normal request. */
export function actingCookieJar(): Jar | null {
  return store.getStore()?.jar ?? null;
}

async function memberSession(profileId: string) {
  const cached = sessions.get(profileId);
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached;
  const admin = createPrivilegedClient();
  const { data: user, error: userError } = await admin.auth.admin.getUserById(profileId);
  const email = user?.user?.email;
  if (userError || !email) throw new Error("MEMBER_UNAVAILABLE");
  // A one-time sign-in token for this member, used at once on the server (no e-mail is sent).
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) throw new Error("MEMBER_SESSION_UNAVAILABLE");
  const { url, anonKey } = getPublicSupabaseConfig();
  const plain = createPlainClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const { data: verified, error: verifyError } = await plain.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  const session = verified?.session;
  if (verifyError || !session || session.user.id !== profileId) throw new Error("MEMBER_SESSION_UNAVAILABLE");
  const fresh = { accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: (session.expires_at ?? Math.floor(Date.now() / 1000) + 3000) * 1000 };
  sessions.set(profileId, fresh);
  return fresh;
}

/** Runs fn with createClient() signed in as the member. */
export async function runAsMember<T>(profileId: string, fn: () => Promise<T>): Promise<T> {
  const session = await memberSession(profileId);
  const jar: Jar = [];
  const { url, anonKey } = getPublicSupabaseConfig();
  const seed = createServerClient(url, anonKey, { cookies: { getAll: () => jar, setAll: (items) => { for (const item of items) { const at = jar.findIndex((cookie) => cookie.name === item.name); if (item.value) { if (at >= 0) jar[at] = { name: item.name, value: item.value }; else jar.push({ name: item.name, value: item.value }); } else if (at >= 0) jar.splice(at, 1); } } } });
  const { data, error } = await seed.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken });
  if (error || data.user?.id !== profileId) { sessions.delete(profileId); throw new Error("MEMBER_SESSION_UNAVAILABLE"); }
  if (data.session) sessions.set(profileId, { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresAt: (data.session.expires_at ?? 0) * 1000 });
  return store.run({ jar }, fn);
}
