import {ingestChannelWebhook} from "@/modules/channels/server/ingest-channel-webhook";
import {ChannelAccountLoadError,loadChannelAdapterByExternalId} from "@/modules/channels/server/load-channel-adapter";
import {ChannelError} from "@/modules/channels/core/channel-errors";

export async function POST(request:Request){
  try{
    const body=await request.text();let payload:unknown;try{payload=JSON.parse(body)}catch{return Response.json({ok:false,code:"JSON_INVALID"},{status:400})}
    const accountId=payload&&typeof payload==="object"&&!Array.isArray(payload)?(payload as {accountId?:unknown}).accountId:null;
    if(typeof accountId!=="string"||accountId.length===0||accountId.length>256)return Response.json({ok:false,code:"SCHEMA_INVALID"},{status:400});
    const loaded=await loadChannelAdapterByExternalId("FACEBOOK_PROFILE","FACEBOOK_PROFILE_BRIDGE",accountId);
    const result=await ingestChannelWebhook({adapter:loaded.adapter,channelAccountId:loaded.channelAccountId,channelType:"FACEBOOK_PROFILE",headers:Object.fromEntries(request.headers.entries()),body});
    return Response.json({accepted:result.accepted});
  }catch(error){
    if(error instanceof ChannelAccountLoadError)return Response.json({ok:false,code:error.safeCode},{status:error.safeCode==="CHANNEL_ACCOUNT_NOT_FOUND"?404:503});
    if(error instanceof ChannelError && error.code==="INVALID_WEBHOOK")return Response.json({ok:false,code:"WEBHOOK_REJECTED"},{status:400});
    return Response.json({ok:false,code:"WEBHOOK_UNAVAILABLE"},{status:503});
  }
}
