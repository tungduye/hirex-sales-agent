import { ingestChannelWebhook } from "@/modules/channels/server/ingest-channel-webhook";
import { ChannelAccountLoadError, loadChannelAdapterByExternalId } from "@/modules/channels/server/load-channel-adapter";

type SafeCode =
  | "JSON_INVALID" | "SCHEMA_INVALID" | "TIMESTAMP_INVALID" | "SIGNATURE_INVALID"
  | "CHANNEL_ACCOUNT_NOT_FOUND" | "CHANNEL_ACCOUNT_QUERY_FAILED" | "CHANNEL_ACCOUNT_ROW_INVALID" | "CHANNEL_CREDENTIAL_DECRYPT_FAILED" | "CHANNEL_CONFIGURATION_INVALID" | "PROVIDER_ACCOUNT_MISMATCH" | "WORKSPACE_RESOLUTION_FAILED"
  | "EVENT_PERSIST_FAILED" | "CONTACT_PROVISION_FAILED" | "CONTACT_CHANNEL_PROVISION_FAILED"
  | "CONVERSATION_PROVISION_FAILED" | "MESSAGE_PERSIST_FAILED" | "INTERNAL_ERROR";

const ingestCodes: Readonly<Record<string, SafeCode>> = {
  WEBHOOK_ACCOUNT_MISMATCH: "PROVIDER_ACCOUNT_MISMATCH",
  WEBHOOK_WORKSPACE_MISMATCH: "WORKSPACE_RESOLUTION_FAILED",
  WEBHOOK_PAYLOAD_INVALID: "SCHEMA_INVALID",
  WEBHOOK_DIRECTION_INVALID: "SCHEMA_INVALID",
  CHANNEL_ACCOUNT_UNAVAILABLE: "CHANNEL_ACCOUNT_NOT_FOUND",
  INBOUND_EVENT_UNAVAILABLE: "EVENT_PERSIST_FAILED",
  CONTACT_IDENTITY_UNAVAILABLE: "CONTACT_PROVISION_FAILED",
  CONTACT_IDENTITY_AMBIGUOUS: "CONTACT_PROVISION_FAILED",
  CONTACT_PERSISTENCE_FAILED: "CONTACT_PROVISION_FAILED",
  CONTACT_CHANNEL_PERSISTENCE_FAILED: "CONTACT_CHANNEL_PROVISION_FAILED",
  CONVERSATION_PERSISTENCE_FAILED: "CONVERSATION_PROVISION_FAILED",
  MESSAGE_PERSISTENCE_FAILED: "MESSAGE_PERSIST_FAILED",
};

function rejection(error: unknown) {
  const diagnosticCode=error instanceof Error&&error.name==="ZaloWebhookDiagnosticError"&&"diagnosticCode" in error?error.diagnosticCode:null;
  if (diagnosticCode === "SIGNATURE_INVALID" || diagnosticCode === "TIMESTAMP_INVALID" || diagnosticCode === "JSON_INVALID" || diagnosticCode === "SCHEMA_INVALID" || diagnosticCode === "PROVIDER_ACCOUNT_MISMATCH") {
    const status = diagnosticCode === "SIGNATURE_INVALID" || diagnosticCode === "TIMESTAMP_INVALID" ? 401 : 400;
    return Response.json({ ok: false, code: diagnosticCode }, { status });
  }
  const loadCode=error instanceof Error&&error.name==="ChannelAccountLoadError"&&"safeCode" in error?error.safeCode:null;
  if(loadCode==="CHANNEL_ACCOUNT_NOT_FOUND"||loadCode==="CHANNEL_ACCOUNT_QUERY_FAILED"||loadCode==="CHANNEL_ACCOUNT_ROW_INVALID"||loadCode==="CHANNEL_CREDENTIAL_DECRYPT_FAILED"||loadCode==="CHANNEL_CONFIGURATION_INVALID"){
    const status=loadCode==="CHANNEL_ACCOUNT_NOT_FOUND"?404:loadCode==="CHANNEL_ACCOUNT_QUERY_FAILED"||loadCode==="CHANNEL_CREDENTIAL_DECRYPT_FAILED"?500:400;
    return Response.json({ok:false,code:loadCode},{status});
  }
  const message = error instanceof Error ? error.message : "";
  const code = ingestCodes[message] ?? (message === "INVALID_ACCOUNT_SHAPE" ? "SCHEMA_INVALID" : message === "INVALID_JSON" ? "JSON_INVALID" : "INTERNAL_ERROR");
  const status = code === "INTERNAL_ERROR" || code.endsWith("_FAILED") ? 500 : code === "CHANNEL_ACCOUNT_NOT_FOUND" ? 404 : 400;
  return Response.json({ ok: false, code }, { status });
}

interface Dependencies {
  load: typeof loadChannelAdapterByExternalId;
  ingest: typeof ingestChannelWebhook;
}

export async function handleZaloWebhook(request: Request, dependencies: Dependencies = { load: loadChannelAdapterByExternalId, ingest: ingestChannelWebhook }) {
  try {
    const body = await request.text();
    let untrusted: unknown;
    try { untrusted = JSON.parse(body); } catch { throw new Error("INVALID_JSON"); }
    if(!untrusted||typeof untrusted!=="object"||Array.isArray(untrusted))throw new Error("INVALID_ACCOUNT_SHAPE");
    const accountId = (untrusted as {accountId?:unknown}).accountId;
    if(typeof accountId!=="string"||accountId.length===0||accountId.length>256)throw new Error("INVALID_ACCOUNT_SHAPE");
    let loaded: Awaited<ReturnType<typeof loadChannelAdapterByExternalId>>;
    try { loaded=await dependencies.load("ZALO","ZALO_BRIDGE",accountId); }
    catch(error) { if(error instanceof ChannelAccountLoadError)throw error; throw new Error("CHANNEL_ACCOUNT_QUERY_FAILED"); }
    const result = await dependencies.ingest({ adapter: loaded.adapter, channelAccountId: loaded.channelAccountId, channelType: "ZALO", headers: Object.fromEntries(request.headers.entries()), body });
    return Response.json({ accepted: result.accepted });
  } catch (error) { return rejection(error); }
}

