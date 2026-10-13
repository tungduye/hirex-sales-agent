import { NextResponse } from "next/server";
import { buildAllFacebookProfileCampaignResponsesExport, buildSelectedFacebookProfileCampaignResponsesExport } from "@/modules/channels/server/zalo-campaign-response-export";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(request:Request) {
  try {
    const selected=new URL(request.url).searchParams.getAll("campaignId").filter(id=>UUID.test(id)).slice(0,100);
    const result = selected.length?await buildSelectedFacebookProfileCampaignResponsesExport(selected):await buildAllFacebookProfileCampaignResponsesExport();
    if (!result?.body || result.count === 0) {
      return NextResponse.json({ error: "NO_FACEBOOK_PROFILE_RESPONSES", message: "Chưa có người phản hồi Facebook cá nhân trong các chiến dịch để xuất." }, { status: 409 });
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
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    console.error("All Facebook Profile campaign responses export failed", error);
    return NextResponse.json({ error: "EXPORT_FAILED" }, { status: 500 });
  }
}
