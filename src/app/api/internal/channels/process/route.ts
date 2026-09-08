import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { processChannelCampaignBatch } from "@/modules/channels/server/process-channel-campaign-batch";

function equal(left:string,right:string){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b)}
const bodySchema=z.object({workspaceId:z.string().uuid(),campaignId:z.string().uuid(),maximumActions:z.number().int().min(1).max(25).optional(),dryRun:z.boolean().optional()});
export async function POST(request:Request){
  const expected=process.env.AUTOMATION_CRON_SECRET?.trim(); const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/iu,"")??"";
  if(!expected||!supplied||!equal(supplied,expected))return Response.json({error:"Unauthorized"},{status:401});
  try{const parsed=bodySchema.safeParse(await request.json());if(!parsed.success)return Response.json({error:"Invalid request"},{status:400});const result=await processChannelCampaignBatch(parsed.data);return Response.json(result)}catch{return Response.json({error:"Channel campaign processing is unavailable."},{status:503})}
}
