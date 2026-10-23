import { NextResponse } from "next/server";
import { getDailyBrief } from "@/modules/assistant/server/daily-brief";

/** "Làm mới" on the brief card. Rebuilt at most once a minute per member. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && !/:\/\/app2?\.hirexmkt\.online$/.test(origin)) {
    return NextResponse.json({ ok: false, message: "Không được phép." }, { status: 403 });
  }
  const result = await getDailyBrief({ refresh: true });
  return NextResponse.json(result, { status: result.ok ? 200 : 401, headers: { "Cache-Control": "no-store" } });
}
