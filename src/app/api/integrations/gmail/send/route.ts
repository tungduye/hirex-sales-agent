import { NextResponse, type NextRequest } from "next/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { sendNewMessageSchema } from "@/modules/integrations/gmail/schemas/send-new-message";
import { sendOneNewGmailMessage } from "@/modules/integrations/gmail/server/send-one-new-message";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "Content-Type must be application/json." }, 415);
  }

  const account = await getAccountContext();
  if (!account) return json({ error: "Authentication required." }, 401);
  if (!account.workspaceId || !account.configurationComplete) {
    return json({ error: "Account configuration is incomplete." }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const parsed = sendNewMessageSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Enter one valid recipient, subject, and plain-text message." }, 400);
  }

  const result = await sendOneNewGmailMessage(parsed.data, account.workspaceId);
  return json(result, 200);
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
