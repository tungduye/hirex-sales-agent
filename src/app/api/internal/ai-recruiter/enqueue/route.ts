import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { enqueueAiRecruiterInbound } from "@/modules/ai-recruiter/server/enqueue-ai-recruiter";

const inputSchema=z.object({
  workspaceId:z.string().uuid(),
  channelAccountId:z.string().uuid(),
  conversationId:z.string().uuid(),
  messageId:z.string().uuid(),
});
function equal(left:string,right:string){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b)}

export async function POST(request:Request){
  const expected=process.env.AUTOMATION_CRON_SECRET?.trim(),supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/iu,"")??"";
  if(!expected||!equal(supplied,expected))return Response.json({error:"Unauthorized"},{status:401});
  const parsed=inputSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:"Invalid request"},{status:400});
  try{return Response.json(await enqueueAiRecruiterInbound(parsed.data));}
  catch{return Response.json({error:"AI Recruiter enqueue is unavailable."},{status:503});}
}
