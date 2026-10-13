import { NextResponse } from "next/server";
import { z } from "zod";
import { buildZaloCampaignResponseExport } from "@/modules/channels/server/zalo-campaign-response-export";

export async function GET(_request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await context.params;
  if (!z.string().uuid().safeParse(campaignId).success) {
    return NextResponse.json({ error: "INVALID_CAMPAIGN" }, { status: 400 });
  }
  try {
    const result = await buildZaloCampaignResponseExport(campaignId);
    if (!result) return NextResponse.json({ error: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
    if (!result.body || result.count === 0) {
      return NextResponse.json({ error: "NO_ZALO_RESPONSES", message: "Chiến dịch chưa có người phản hồi Zalo để xuất." }, { status: 409 });
    }
    return new NextResponse(new Uint8Array(result.body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    console.error("Zalo campaign response export failed", error);
    return NextResponse.json({ error: "EXPORT_FAILED" }, { status: 500 });
  }
}
