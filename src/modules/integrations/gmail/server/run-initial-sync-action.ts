"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { runInitialSyncBatch } from "@/modules/integrations/gmail/server/run-initial-sync-batch";
import { listInitialSyncStates } from "@/modules/integrations/gmail/server/list-initial-sync-states";
import type { InitialSyncActionState } from "@/modules/integrations/gmail/types/initial-sync";

export async function runInitialSyncBatchAction(
  _state: InitialSyncActionState,
  formData: FormData,
): Promise<InitialSyncActionState> {
  const emailAccountId = z.uuid().safeParse(formData.get("emailAccountId"));
  if (!emailAccountId.success) return { success: false, completed: false, message: "This email account could not be synced." };
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return { success: false, completed: false, message: "Your account is not ready to sync Gmail." };

  const result = await runInitialSyncBatch({ workspaceId: account.workspaceId, emailAccountId: emailAccountId.data });
  const progressResult = await listInitialSyncStates();
  const progress = progressResult.states.find((state) => state.emailAccountId === emailAccountId.data) ?? null;
  revalidatePath("/settings");
  revalidatePath("/inbox");
  return { ...result, progress };
}
