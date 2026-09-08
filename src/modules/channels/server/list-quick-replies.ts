import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { CHANNEL_TYPES, type ChannelType } from "../core/channel-contracts";
import type { QuickReplyTemplate } from "../types/quick-reply";

interface Row { id: unknown; name: unknown; shortcut: unknown; text_content: unknown; channel_types: unknown }

export async function listQuickReplies(): Promise<{ templates: QuickReplyTemplate[]; error: string | null }> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return { templates: [], error: "Quick replies are unavailable." };
  const client = await createClient();
  const { data, error } = await client.from("quick_reply_templates").select("id,name,shortcut,text_content,channel_types").eq("workspace_id", account.workspaceId).order("name");
  if (error) return { templates: [], error: "Quick replies are not available yet." };
  const templates: QuickReplyTemplate[] = [];
  for (const row of data as Row[]) {
    if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.shortcut !== "string" || typeof row.text_content !== "string" || !Array.isArray(row.channel_types) || !row.channel_types.every((type) => typeof type === "string" && CHANNEL_TYPES.includes(type as ChannelType))) return { templates: [], error: "Quick reply data is unavailable." };
    templates.push({ id: row.id, name: row.name, shortcut: row.shortcut, textContent: row.text_content, channelTypes: row.channel_types as ChannelType[] });
  }
  return { templates, error: null };
}
