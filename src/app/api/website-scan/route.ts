import { z } from "zod";
import { hasPermission } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { scanWebsite } from "@/modules/website-scan/server/scan-website";

export const runtime = "nodejs";
export const maxDuration = 180;

const inputSchema = z.object({ companyName: z.string().trim().max(300).default(""), website: z.string().trim().min(3).max(2000), mode: z.enum(["FULL", "CONTACT", "EVALUATION"]).default("FULL") });

export async function POST(request: Request) {
  const account = await getAccountContext();
  if (!account?.workspaceId || !await hasPermission("scan.website")) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const input = inputSchema.parse(await request.json());
    const result = await scanWebsite(input);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
    console.error("WEBSITE_SCAN_FAILED", error instanceof Error ? error.message : "UNKNOWN");
    return Response.json({ error: "SCAN_FAILED" }, { status: 500 });
  }
}
