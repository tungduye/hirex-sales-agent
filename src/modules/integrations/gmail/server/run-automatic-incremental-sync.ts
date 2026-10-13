import "server-only";
import { runInitialSyncBatch } from "@/modules/integrations/gmail/server/run-initial-sync-batch";
import { processPersistedCampaignBounces, processPersistedCampaignReplies } from "@/modules/campaigns/server/process-campaign-signals";

import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import { runIncrementalSyncBatch, type IncrementalBatchCode } from "@/modules/integrations/gmail/server/run-incremental-sync-batch";

export const MAX_ACCOUNTS_PER_RUN = 10;
export const MAX_BATCHES_PER_ACCOUNT = 3;

interface EligibleAccountRow { id: string; workspace_id: string }
interface AccountResult { emailAccountId: string; code: IncrementalBatchCode; batchesProcessed: number }

export interface AutomaticIncrementalSyncResult {
  success: true;
  accountsConsidered: number;
  accountsProcessed: number;
  accountsCompleted: number;
  accountsRemaining: number;
  accountsSkipped: number;
  accountsFailed: number;
  historyPagesProcessed: number;
  accounts: AccountResult[];
}

export async function runAutomaticIncrementalSync(): Promise<AutomaticIncrementalSyncResult> {
  const accounts = await listEligibleAccounts();
  const result: AutomaticIncrementalSyncResult = {
    success: true,
    accountsConsidered: accounts.length,
    accountsProcessed: 0,
    accountsCompleted: 0,
    accountsRemaining: 0,
    accountsSkipped: 0,
    accountsFailed: 0,
    historyPagesProcessed: 0,
    accounts: [],
  };

  for (const account of accounts) {
    let finalCode: IncrementalBatchCode = "FAILED";
    let batchesProcessed = 0;
    try {
      for (let batch = 0; batch < MAX_BATCHES_PER_ACCOUNT; batch += 1) {
        const batchResult = await runIncrementalSyncBatch({
          workspaceId: account.workspace_id,
          emailAccountId: account.id,
        });
        finalCode = batchResult.code;
        if (batchResult.success) {
          batchesProcessed += 1;
          result.historyPagesProcessed += 1;
        }
        if (batchResult.code !== "MORE_REMAIN") break;
      }
    } catch {
      finalCode = "FAILED";
    }

    result.accounts.push({ emailAccountId: account.id, code: finalCode, batchesProcessed });
    if (finalCode === "SYNC_BUSY") {
      if (batchesProcessed === 0) result.accountsSkipped += 1;
      else {
        result.accountsProcessed += 1;
        result.accountsRemaining += 1;
      }
      continue;
    }
    result.accountsProcessed += 1;
    if (finalCode === "OK") result.accountsCompleted += 1;
    else if (finalCode === "MORE_REMAIN") result.accountsRemaining += 1;
    else result.accountsFailed += 1;
  }

  // Bootstrap previously connected mailboxes too. Rotate by checkpoint time so
  // one large mailbox cannot starve the remaining accounts. Existing batch locks
  // make this safe alongside the manual initial-sync button.
  const db=createPrivilegedSupabaseClient();
  const pending=await db.from('email_accounts')
    .select('id,workspace_id,email_sync_states(sync_type,status,last_batch_at,updated_at)')
    .eq('provider','GMAIL').eq('status','CONNECTED').is('provider_history_id',null);
  if(pending.error)throw new Error('INITIAL_SYNC_ACCOUNT_SELECTION_FAILED');
  const initial=(pending.data??[]).map(account=>({account,state:account.email_sync_states?.find(state=>state.sync_type==='INITIAL')}))
    .filter(({state})=>state?.status!=='COMPLETED')
    .sort((a,b)=>Date.parse(a.state?.last_batch_at??a.state?.updated_at??'1970-01-01')-Date.parse(b.state?.last_batch_at??b.state?.updated_at??'1970-01-01'))
    .slice(0,2);
  for(const {account} of initial){
    const batch=await runInitialSyncBatch({workspaceId:account.workspace_id,emailAccountId:account.id});
    result.accountsConsidered+=1;result.accountsProcessed+=1;
    if(!batch.success)result.accountsFailed+=1;
    else if(batch.completed)result.accountsCompleted+=1;
    else result.accountsRemaining+=1;
    result.accounts.push({emailAccountId:account.id,code:batch.success?(batch.completed?'OK':'MORE_REMAIN'):'FAILED',batchesProcessed:batch.success?1:0});
  }
  if(initial.length){await processPersistedCampaignReplies(100);await processPersistedCampaignBounces(100);}
  return result;
}

async function listEligibleAccounts() {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.from("email_accounts")
    .select("id, workspace_id, email_sync_states!inner(sync_type, status)")
    .eq("provider", "GMAIL")
    .eq("status", "CONNECTED")
    .not("provider_history_id", "is", null)
    .eq("email_sync_states.sync_type", "INITIAL")
    .eq("email_sync_states.status", "COMPLETED")
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(MAX_ACCOUNTS_PER_RUN);
  if (error) throw new Error("AUTOMATIC_SYNC_ACCOUNT_SELECTION_FAILED");
  return (data ?? []).map((row) => ({ id: row.id, workspace_id: row.workspace_id })) as EligibleAccountRow[];
}
