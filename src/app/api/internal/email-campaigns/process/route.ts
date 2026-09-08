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
  try{const campaignsActivated=await activateDueEmailCampaigns();const replies=await processPersistedCampaignReplies(50);const bounces=await processPersistedCampaignBounces(50);if(replies.error||bounces.error)throw new Error("SIGNAL_REFRESH_FAILED");const legacy=await processEmailCampaignBatch(10);const sequence=await processEmailCampaignSequenceBatch(10);const counts={campaigns_considered:(legacy.campaignsConsidered??0)+(sequence.campaignsConsidered??0),deliveries_processed:(legacy.recipientsProcessed??0)+(sequence.deliveriesProcessed??0),sent:(legacy.sent??0)+(sequence.sent??0),failed:(legacy.failed??0)+(sequence.failed??0),delivery_unknown:(legacy.deliveryUnknown??0)+(sequence.deliveryUnknown??0),replied_stopped:replies.repliedStopped,bounced_stopped:bounces.bouncedStopped};await finishCampaignWorkerRun(run.id,"SUCCEEDED",counts,null);return Response.json({campaignsActivated,legacy,sequence,repliedStopped:replies.repliedStopped,bouncedStopped:bounces.bouncedStopped},{headers:{"Cache-Control":"no-store"}});}catch{await finishCampaignWorkerRun(run.id,"FAILED",{},"WORKER_UNAVAILABLE");return Response.json({success:false,message:"Campaign processing is unavailable."},{status:500});}
}
