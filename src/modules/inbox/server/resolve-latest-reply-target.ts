import "server-only";

import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import { evaluateReplyTarget } from "@/modules/integrations/gmail/server/evaluate-reply-target";
import type { ReplyComposerContext } from "@/modules/inbox/types/inbox";

const MAX_CANDIDATES = 20;

export async function resolveLatestReplyTargetForThread(threadId: string, emailAccountId: string): Promise<ReplyComposerContext> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return unavailable();
  const supabase = createPrivilegedSupabaseClient();
  const { data: gmail } = await supabase.from("email_accounts").select("id, status, scopes")
    .eq("id", emailAccountId).eq("workspace_id", account.workspaceId).eq("provider", "GMAIL").maybeSingle();
  if (!gmail) return unavailable();
  if (gmail.status === "REAUTH_REQUIRED") return { status: "REAUTH_REQUIRED", emailAccountId, emailMessageId: null, message: "Reconnect Gmail before replying." };
  if (gmail.status !== "CONNECTED") return unavailable();
  if (!Array.isArray(gmail.scopes) || !gmail.scopes.includes("https://www.googleapis.com/auth/gmail.send")) {
    return { status: "SEND_SCOPE_REQUIRED", emailAccountId, emailMessageId: null, message: "Enable Gmail sending for this account." };
  }
  const { data, error } = await supabase.from("email_messages").select("id")
    .eq("workspace_id", account.workspaceId).eq("email_account_id", emailAccountId)
    .eq("email_thread_id", threadId).eq("direction", "INBOUND")
    .order("provider_internal_date", { ascending: false, nullsFirst: false }).limit(MAX_CANDIDATES);
  if (error) return unavailable();
  for (const row of data ?? []) {
    const result = await evaluateReplyTarget({ workspaceId: account.workspaceId, emailAccountId, emailMessageId: row.id });
    if (result.classification === "SAFE_REPLY_TARGET") {
      return { status: "READY", emailAccountId, emailMessageId: row.id, message: "Reply ready." };
    }
  }
  return { status: "NOT_REPLYABLE", emailAccountId, emailMessageId: null, message: "This conversation is not currently replyable." };
}
function unavailable(): ReplyComposerContext { return { status: "UNAVAILABLE", emailAccountId: null, emailMessageId: null, message: "Reply is temporarily unavailable." }; }
