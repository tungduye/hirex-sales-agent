import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

export function createPrivilegedSupabaseClient() {
  return createPrivilegedClient();
}
