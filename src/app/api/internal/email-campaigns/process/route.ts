import { activateDueEmailCampaigns, processEmailCampaignBatch } from "@/modules/campaigns/server/process-email-campaign-batch";
import { processEmailCampaignSequenceBatch } from "@/modules/campaigns/server/process-email-campaign-sequence-batch";
import { processPersistedCampaignBounces,processPersistedCampaignReplies } from "@/modules/campaigns/server/process-campaign-signals";
import { getAutomationCronSecret, isValidAutomationBearer } from "@/modules/integrations/gmail/server/automation-auth";

export const runtime="nodejs";
export async function POST(request:Request){
  let secret:string; try{secret=getAutomationCronSecret();}catch{return Response.json({success:false,message:"Campaign automation is not configured."},{status:500});}
  if(!isValidAutomationBearer(request.headers.get("authorization"),secret)) return Response.json({success:false,message:"Unauthorized."},{status:401});
  try{const campaignsActivated=await activateDueEmailCampaigns();const replies=await processPersistedCampaignReplies(50);const bounces=await processPersistedCampaignBounces(50);if(replies.error||bounces.error)throw new Error("SIGNAL_REFRESH_FAILED");const legacy=await processEmailCampaignBatch(10);const sequence=await processEmailCampaignSequenceBatch(10);return Response.json({campaignsActivated,legacy,sequence,repliedStopped:replies.repliedStopped,bouncedStopped:bounces.bouncedStopped},{headers:{"Cache-Control":"no-store"}});}catch{return Response.json({success:false,message:"Campaign processing is unavailable."},{status:500});}
}
