import { activateDueEmailCampaigns, processEmailCampaignBatch } from "@/modules/campaigns/server/process-email-campaign-batch";
import { processEmailCampaignSequenceBatch } from "@/modules/campaigns/server/process-email-campaign-sequence-batch";
import { processPersistedCampaignBounces,processPersistedCampaignReplies } from "@/modules/campaigns/server/process-campaign-signals";
import { getAutomationCronSecret, isValidAutomationBearer } from "@/modules/integrations/gmail/server/automation-auth";
import { finishCampaignWorkerRun,startCampaignWorkerRun } from "@/modules/campaigns/server/campaign-worker-health";

export const runtime="nodejs";
export async function POST(request:Request){
  let secret:string; try{secret=getAutomationCronSecret();}catch{return Response.json({success:false,message:"Campaign automation is not configured."},{status:500});}
  if(!isValidAutomationBearer(request.headers.get("authorization"),secret)) return Response.json({success:false,message:"Unauthorized."},{status:401});
  const dryRun=request.headers.get("x-hirex-dry-run")==="1";const run=await startCampaignWorkerRun(dryRun?"DRY_RUN":"SCHEDULER");if(!run)return Response.json({success:false,message:"Campaign processing is unavailable."},{status:500});
  if(dryRun){await finishCampaignWorkerRun(run.id,"DRY_RUN",{},null);return Response.json({success:true,dryRun:true},{headers:{"Cache-Control":"no-store"}});}
  const counts: Record<string, number> = {};
  const fail = async (code: string) => {
    await finishCampaignWorkerRun(run.id, "FAILED", counts, code);
    return Response.json({ success: false, code }, { status: 500, headers: { "Cache-Control": "no-store" } });
  };
  try {
    const campaignsActivated = await activateDueEmailCampaigns();
    const replies = await processPersistedCampaignReplies(50);
    const bounces = await processPersistedCampaignBounces(50);
    if (replies.error || bounces.error) return fail("SIGNAL_REFRESH_FAILED");
    counts.replied_stopped = replies.repliedStopped;
    counts.bounced_stopped = bounces.bouncedStopped;
    const legacy = await processEmailCampaignBatch(10);
    Object.assign(counts, { campaigns_considered: legacy.campaignsConsidered, deliveries_processed: legacy.recipientsProcessed, sent: legacy.sent, failed: legacy.failed, delivery_unknown: legacy.deliveryUnknown });
    if (!legacy.success) return fail(legacy.code);
    const sequence = await processEmailCampaignSequenceBatch(10);
    counts.campaigns_considered += sequence.campaignsConsidered;
    counts.deliveries_processed += sequence.deliveriesProcessed;
    counts.sent += sequence.sent;
    counts.failed += sequence.failed;
    counts.delivery_unknown += sequence.deliveryUnknown;
    if (!sequence.success) return fail(sequence.code);
    if (!await finishCampaignWorkerRun(run.id, "SUCCEEDED", counts, null)) return fail("WORKER_FINALIZATION_UNAVAILABLE");
    return Response.json({ success: true, campaignsActivated, legacy, sequence, repliedStopped: replies.repliedStopped, bouncedStopped: bounces.bouncedStopped }, { headers: { "Cache-Control": "no-store" } });
  } catch { return fail("WORKER_UNAVAILABLE"); }
}
