import { NextResponse } from "next/server";
import { buildCampaignExport } from "@/modules/campaigns/server/campaign-report-export";
import { buildEmailCampaignResponseExport } from "@/modules/campaigns/server/email-campaign-response-export";

export async function GET(request:Request,{params}:{params:Promise<{campaignId:string}>}) {
  const {campaignId}=await params;const format=new URL(request.url).searchParams.get("format")==="xlsx"?"xlsx":"csv";
  if(format==="xlsx"){
    const result=await buildEmailCampaignResponseExport({campaignId});
    if(!result)return NextResponse.json({error:"Report unavailable."},{status:404});
    if(!result.body)return NextResponse.json({error:"No replied recipients in this campaign."},{status:404});
    return new NextResponse(new Uint8Array(result.body),{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="${result.filename}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }
  const result=await buildCampaignExport(campaignId,format);if(!result)return NextResponse.json({error:"Report unavailable."},{status:404});
  return new NextResponse(new Uint8Array(result.body),{headers:{"Content-Type":result.contentType,"Content-Disposition":`attachment; filename="campaign-report.${result.extension}"`,"Cache-Control":"private, no-store"}});
}
