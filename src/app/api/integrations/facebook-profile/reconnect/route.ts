import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requirePermission, canAccessChannelAccount } from "@/modules/access/server/access-control";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import { decryptChannelCredential } from "@/modules/channels/server/channel-credential-encryption";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const origin=request.headers.get("origin"),host=request.headers.get("x-forwarded-host")??request.headers.get("host"),proto=request.headers.get("x-forwarded-proto")??request.nextUrl.protocol.replace(":","");
  if(!origin||!host||origin!==`${proto}://${host}`)return NextResponse.json({error:"FORBIDDEN"},{status:403});
  let workspaceId:string;
  try{workspaceId=(await requirePermission("channels.manage")).workspaceId;}catch{return NextResponse.json({error:"FORBIDDEN"},{status:403});}
  const parsed=z.object({accountId:z.string().uuid()}).safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:"INVALID_INPUT"},{status:400});
  if(!await canAccessChannelAccount(parsed.data.accountId))return NextResponse.json({error:"FORBIDDEN"},{status:403});
  const {data:account,error}=await createPrivilegedSupabaseClient().from("channel_accounts").select("external_account_id").eq("id",parsed.data.accountId).eq("workspace_id",workspaceId).eq("channel_type","FACEBOOK_PROFILE").eq("provider","FACEBOOK_PROFILE_BRIDGE").maybeSingle();
  if(error||!account)return NextResponse.json({error:"ACCOUNT_UNAVAILABLE"},{status:404});
  try{
    const {data:credential,error:credentialError}=await createPrivilegedSupabaseClient().from("channel_account_credentials").select("webhook_secret_encrypted").eq("channel_account_id",parsed.data.accountId).eq("workspace_id",workspaceId).maybeSingle();
    if(credentialError||!credential)return NextResponse.json({error:"SESSION_UNAVAILABLE"},{status:409});
    const activeSecret=decryptChannelCredential(credential.webhook_secret_encrypted);
    const matches=[];
    for(const entry of await readdir(resolve("runtime"),{withFileTypes:true})){
      if(!entry.isDirectory()||!/^facebook-profile-bridge(?:-[a-z0-9-]+)?$/.test(entry.name))continue;
      const config=await readFile(resolve("runtime",entry.name,"config.json"),"utf8").then(JSON.parse).catch(()=>null);
      if(config?.accountId===account.external_account_id&&Number.isInteger(config.port)&&config.port>0&&config.port<65536&&typeof config.secret==="string"&&config.secret.length>=32&&config.secret===activeSecret)matches.push(config);
    }
    if(matches.length!==1)return NextResponse.json({error:"SESSION_UNAVAILABLE"},{status:409});
    const config=matches[0];
    const response=await fetch(`http://127.0.0.1:${config.port}/v1/session/reconnect`,{method:"POST",headers:{Authorization:`Bearer ${config.secret}`},signal:AbortSignal.timeout(40000),cache:"no-store"});
    if(!response.ok)return NextResponse.json({error:"BRIDGE_UNAVAILABLE"},{status:503});
    return NextResponse.json({message:"Đã mở Messenger trên máy chạy HireX. Anh tự hoàn tất đăng nhập/PIN tại cửa sổ đó; không gửi mã PIN vào chat."},{headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"BRIDGE_UNAVAILABLE"},{status:503});}
}
