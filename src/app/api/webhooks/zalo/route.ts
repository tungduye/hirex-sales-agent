import { ingestChannelWebhook } from "@/modules/channels/server/ingest-channel-webhook";
import { loadChannelAdapterByExternalId } from "@/modules/channels/server/load-channel-adapter";

export async function POST(request: Request) {
  try {
    const body=await request.text(); const untrusted=JSON.parse(body) as {accountId?:unknown}; const accountId=untrusted.accountId;
    if(typeof accountId!=="string"||accountId.length===0||accountId.length>256)throw new Error("INVALID_WEBHOOK");
    const loaded=await loadChannelAdapterByExternalId("ZALO","ZALO_BRIDGE",accountId);
    const result = await ingestChannelWebhook({ adapter: loaded.adapter, channelAccountId: loaded.channelAccountId, channelType: "ZALO", headers: Object.fromEntries(request.headers.entries()), body });
    return Response.json({ accepted: result.accepted });
  } catch { return Response.json({ error: "Webhook could not be processed." }, { status: 400 }); }
}
