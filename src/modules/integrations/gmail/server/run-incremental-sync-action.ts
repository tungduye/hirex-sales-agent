"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { listIncrementalSyncStates } from "@/modules/integrations/gmail/server/list-incremental-sync-states";
import { runIncrementalSyncBatch } from "@/modules/integrations/gmail/server/run-incremental-sync-batch";
import type { IncrementalSyncActionState } from "@/modules/integrations/gmail/types/incremental-sync";

export async function runIncrementalSyncBatchAction(
  _state: IncrementalSyncActionState,
  formData: FormData,
): Promise<IncrementalSyncActionState> {
  const emailAccountId = z.uuid().safeParse(formData.get("emailAccountId"));
  if (!emailAccountId.success) return failure("This email account could not be synced.");
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return failure("Your account is not ready to sync Gmail.");

  const result = await runIncrementalSyncBatch({
    workspaceId: account.workspaceId,
    emailAccountId: emailAccountId.data,
  });
  const progressResult = await listIncrementalSyncStates();
  const progress = progressResult.states.find((item) => item.emailAccountId === emailAccountId.data) ?? null;
  revalidatePath("/settings");
  revalidatePath("/inbox");
  return {
    success: result.success,
    completed: result.completed,
    message: result.message,
    progress,
  };
}

function failure(message: string): IncrementalSyncActionState {
  return { success: false, completed: false, message };
}
