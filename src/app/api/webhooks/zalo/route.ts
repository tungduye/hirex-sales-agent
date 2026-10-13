import { handleZaloWebhook } from "@/modules/channels/server/handle-zalo-webhook";

export async function POST(request: Request) {
  return handleZaloWebhook(request);
}
