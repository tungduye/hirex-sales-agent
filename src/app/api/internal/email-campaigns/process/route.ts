import { activateDueEmailCampaigns, processEmailCampaignBatch } from "@/modules/campaigns/server/process-email-campaign-batch";
import { getAutomationCronSecret, isValidAutomationBearer } from "@/modules/integrations/gmail/server/automation-auth";

export const runtime="nodejs";
export async function POST(request:Request){
  let secret:string; try{secret=getAutomationCronSecret();}catch{return Response.json({success:false,message:"Campaign automation is not configured."},{status:500});}
  if(!isValidAutomationBearer(request.headers.get("authorization"),secret)) return Response.json({success:false,message:"Unauthorized."},{status:401});
  try{const campaignsActivated=await activateDueEmailCampaigns();const batch=await processEmailCampaignBatch(10);return Response.json({campaignsActivated,...batch},{headers:{"Cache-Control":"no-store"}});}catch{return Response.json({success:false,message:"Campaign processing is unavailable."},{status:500});}
}
