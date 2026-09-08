import { ingestChannelWebhook } from "@/modules/channels/server/ingest-channel-webhook";
import { loadChannelAdapterByExternalId } from "@/modules/channels/server/load-channel-adapter";

export async function GET(request: Request) {
  try {
    const verifyToken = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN?.trim();
    if (!verifyToken) throw new Error("FACEBOOK_WEBHOOK_NOT_CONFIGURED");
    const url = new URL(request.url);
    if (url.searchParams.get("hub.mode") !== "subscribe" || url.searchParams.get("hub.verify_token") !== verifyToken) return new Response("Forbidden", { status: 403 });
    const challenge = url.searchParams.get("hub.challenge");
    return challenge ? new Response(challenge, { status: 200 }) : new Response("Bad Request", { status: 400 });
  } catch { return new Response("Unavailable", { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const body=await request.text(); const untrusted=JSON.parse(body) as {entry?:Array<{id?:unknown}>}; const pageId=untrusted.entry?.[0]?.id;
    if(typeof pageId!=="string"||pageId.length===0||pageId.length>256)throw new Error("INVALID_WEBHOOK");
    const loaded = await loadChannelAdapterByExternalId("FACEBOOK", "META_GRAPH", pageId);
    const headers = Object.fromEntries(request.headers.entries());
    const result = await ingestChannelWebhook({ adapter: loaded.adapter, channelAccountId: loaded.channelAccountId, channelType: "FACEBOOK", headers, body });
    return Response.json({ accepted: result.accepted });
  } catch { return Response.json({ error: "Webhook could not be processed." }, { status: 400 }); }
}
