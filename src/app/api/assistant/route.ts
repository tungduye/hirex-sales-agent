import { NextResponse } from "next/server";
import { z } from "zod";
import { runAssistantRequest } from "@/modules/assistant/server/run-assistant-request";

const bodySchema = z.object({
  question: z.string().trim().min(1).max(1000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(40).default([]),
  pagePath: z.string().max(300).nullable().default(null),
  allowDocuments: z.boolean().default(false),
  uploadId: z.string().uuid().nullable().default(null),
});

export async function POST(request: Request) {
  // Same-origin only: the panel calls this from the app itself.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && !origin.endsWith("://app.hirexmkt.online")) {
    return NextResponse.json({ ok: false, message: "Không được phép." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Câu hỏi không hợp lệ (tối đa 1000 ký tự)." }, { status: 400 });
  const result = await runAssistantRequest(parsed.data);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status, headers: { "Cache-Control": "no-store" } });
}
