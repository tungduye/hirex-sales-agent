import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import { verifyUnsubscribeToken } from "@/modules/campaigns/server/unsubscribe-token";

export default async function UnsubscribePage({searchParams}:{searchParams:Promise<{token?:string}>}) {
  const {token}=await searchParams;const payload=token?verifyUnsubscribeToken(token):null;let success=false;
  if(payload){const db=createPrivilegedSupabaseClient();const {data:existing,error:readError}=await db.from("email_suppressions").select("reason").eq("workspace_id",payload.workspaceId).eq("normalized_email",payload.email).maybeSingle();
    if(!readError&&existing?.reason==="HARD_BOUNCE")success=true;
    else if(!readError&&existing){const {error}=await db.from("email_suppressions").update({reason:"UNSUBSCRIBED",source:"SIGNED_LINK"}).eq("workspace_id",payload.workspaceId).eq("normalized_email",payload.email).eq("reason","MANUAL");success=!error;}
    else if(!readError){const {error}=await db.from("email_suppressions").insert({workspace_id:payload.workspaceId,normalized_email:payload.email,reason:"UNSUBSCRIBED",source:"SIGNED_LINK"});success=!error;}
    if(success){const {data:recipients}=await db.from("email_campaign_recipients").select("id").eq("workspace_id",payload.workspaceId).eq("normalized_email",payload.email).eq("engagement_status","ACTIVE");for(const recipient of recipients??[])await db.rpc("apply_email_campaign_signal",{p_workspace_id:payload.workspaceId,p_recipient_id:recipient.id,p_signal_type:"UNSUBSCRIBE",p_source_key:`unsubscribe:${recipient.id}`,p_email_message_id:null,p_diagnostic:null});}
  }
  return <main className="mx-auto flex min-h-screen max-w-lg items-center p-6"><div className="w-full rounded-xl border bg-white p-8 text-center"><h1 className="text-xl font-semibold">Email preferences</h1><p className="mt-3 text-sm text-slate-600">{success?"You have been unsubscribed from future HireX campaign emails.":"This unsubscribe link is invalid or expired."}</p></div></main>;
}
