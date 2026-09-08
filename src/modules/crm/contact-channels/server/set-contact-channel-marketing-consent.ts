"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type { CreateContactChannelState } from "../types/create-contact-channel-state";

const schema=z.object({
  contactId:z.string().uuid(),
  channelId:z.string().uuid(),
  status:z.enum(["UNKNOWN","OPTED_IN","OPTED_OUT"]),
  source:z.string().trim().max(200),
}).superRefine((value,context)=>{if(value.status!=="UNKNOWN"&&!value.source)context.addIssue({code:"custom",path:["source"],message:"Consent source is required."})});

export async function setContactChannelMarketingConsent(_state:CreateContactChannelState,formData:FormData):Promise<CreateContactChannelState>{
  const parsed=schema.safeParse({contactId:formData.get("contactId"),channelId:formData.get("channelId"),status:formData.get("status"),source:formData.get("source")});
  if(!parsed.success)return{success:false,message:"Choose a valid consent status and source."};
  const account=await getAccountContext();if(!account?.workspaceId||!account.configurationComplete)return{success:false,message:"Your account is not ready to update consent."};
  const client=await createClient();const{data,error}=await client.rpc("set_contact_channel_marketing_consent",{p_contact_channel_id:parsed.data.channelId,p_status:parsed.data.status,p_source:parsed.data.source});
  if(error||data!==true)return{success:false,message:"Marketing consent could not be updated."};
  revalidatePath(`/contacts/${parsed.data.contactId}`);return{success:true,message:"Marketing consent updated."};
}
