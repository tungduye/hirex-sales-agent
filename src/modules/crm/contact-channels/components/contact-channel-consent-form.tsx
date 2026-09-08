"use client";

import { useActionState } from "react";
import { setContactChannelMarketingConsent } from "../server/set-contact-channel-marketing-consent";
import type { ContactChannel } from "../types/contact-channel";
import type { CreateContactChannelState } from "../types/create-contact-channel-state";

const initial:CreateContactChannelState={success:false,message:""};

export function ContactChannelConsentForm({contactId,channel}:{contactId:string;channel:ContactChannel}){
  const[state,action,pending]=useActionState(setContactChannelMarketingConsent,initial);
  return <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
    <input type="hidden" name="contactId" value={contactId}/><input type="hidden" name="channelId" value={channel.id}/>
    <select name="status" defaultValue={channel.marketingConsentStatus} className="rounded border bg-white px-2 py-1 text-xs"><option value="UNKNOWN">Consent unknown</option><option value="OPTED_IN">Marketing opted in</option><option value="OPTED_OUT">Marketing opted out</option></select>
    <input name="source" defaultValue={channel.marketingConsentSource??""} maxLength={200} placeholder="Consent source" className="rounded border px-2 py-1 text-xs"/>
    <button disabled={pending} className="rounded border bg-white px-2 py-1 text-xs font-semibold">{pending?"Saving…":"Save consent"}</button>
    {state.message?<span className={`text-xs ${state.success?"text-emerald-700":"text-rose-600"}`}>{state.message}</span>:null}
  </form>;
}
