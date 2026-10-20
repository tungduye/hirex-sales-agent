import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";
import { actingCookieJar } from "@/lib/supabase/acting-session";

export async function createClient() {
  const { url, anonKey } = getPublicSupabaseConfig();
  // Zalo Trợ lý worker: acting for the member who asked (see acting-session.ts), not a browser.
  const jar = actingCookieJar();
  if (jar) return createServerClient(url, anonKey, { cookies: { getAll: () => jar, setAll: () => undefined } });
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always write cookies. src/proxy.ts
          // refreshes the session before rendering protected routes.
        }
      },
    },
  });
}
