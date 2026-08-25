import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getGmailServerConfig } from "@/modules/integrations/gmail/server/config";

export function createPrivilegedSupabaseClient() {
  const config = getGmailServerConfig();

  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
