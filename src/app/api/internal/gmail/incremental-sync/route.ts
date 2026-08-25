import { getAutomationCronSecret, isValidAutomationBearer } from "@/modules/integrations/gmail/server/automation-auth";
import { runAutomaticIncrementalSync } from "@/modules/integrations/gmail/server/run-automatic-incremental-sync";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let secret: string;
  try {
    secret = getAutomationCronSecret();
  } catch {
    return Response.json({ success: false, message: "Automatic sync is not configured." }, { status: 500 });
  }

  if (!isValidAutomationBearer(request.headers.get("authorization"), secret)) {
    return Response.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  try {
    return Response.json(await runAutomaticIncrementalSync(), {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ success: false, message: "Automatic sync could not be started." }, { status: 500 });
  }
}
