import { NextResponse } from "next/server";
import { buildCampaignExport } from "@/modules/campaigns/server/campaign-report-export";

export async function GET(request:Request,{params}:{params:Promise<{campaignId:string}>}) {
  const {campaignId}=await params;const format=new URL(request.url).searchParams.get("format")==="xlsx"?"xlsx":"csv";
  const result=await buildCampaignExport(campaignId,format);if(!result)return NextResponse.json({error:"Report unavailable."},{status:404});
  return new NextResponse(new Uint8Array(result.body),{headers:{"Content-Type":result.contentType,"Content-Disposition":`attachment; filename="campaign-report.${result.extension}"`,"Cache-Control":"private, no-store"}});
}
