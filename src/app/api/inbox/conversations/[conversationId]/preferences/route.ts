import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { canAccessChannelAccount, hasPermission } from "@/modules/access/server/access-control";

const schema=z.object({action:z.enum(["MARK_READ","MARK_UNREAD","TOGGLE_MUTE","TOGGLE_PIN","TOGGLE_OTHER","SOFT_DELETE"])});
export async function POST(request:Request,{params}:{params:Promise<{conversationId:string}>}){
  const {conversationId}=await params,parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success||!z.string().uuid().safeParse(conversationId).success)return Response.json({error:"Invalid request"},{status:400});
  const account=await getAccountContext();
  if(!account?.workspaceId)return Response.json({error:"UNAUTHORIZED"},{status:401});
  if(!await hasPermission("inbox.update"))return Response.json({error:"FORBIDDEN"},{status:403});
  const {data:conversation}=await createPrivilegedClient().from("omnichannel_conversations").select("channel_account_id").eq("id",conversationId).eq("workspace_id",account.workspaceId).maybeSingle();
  if(!conversation||!await canAccessChannelAccount(conversation.channel_account_id))return Response.json({error:"NOT_FOUND"},{status:404});
  const client=await createClient();const{data,error}=await client.rpc("update_inbox_conversation_preference",{p_conversation_id:conversationId,p_action:parsed.data.action});
  if(error||data!==true)return Response.json({error:"Không thể cập nhật hội thoại"},{status:403});
  return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
}
