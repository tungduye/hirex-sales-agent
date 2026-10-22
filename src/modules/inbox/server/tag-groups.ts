"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { requirePermission } from "@/modules/access/server/access-control";

/** Nhóm thẻ (Thị trường, Vị trí, Loại liên hệ…) of each Suối Nguồn tag: Soda counts by them. */
export async function saveTagGroups(formData: FormData) {
  const account = await requirePermission("inbox.update");
  const db = createPrivilegedClient();
  const changes: Array<{ id: string; group: string | null }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("group:")) continue;
    const id = key.slice(6);
    if (!z.string().uuid().safeParse(id).success) continue;
    const group = String(value).replace(/\s+/gu, " ").trim().slice(0, 60);
    const before = String(formData.get(`before:${id}`) ?? "");
    if (group === before) continue;
    changes.push({ id, group: group || null });
  }
  for (const change of changes.slice(0, 500))
    await db.from("conversation_tags").update({ group_name: change.group }).eq("id", change.id).eq("workspace_id", account.workspaceId);
  revalidateTag("inbox-metadata", { expire: 0 });
  revalidatePath("/inbox/tags");
}
