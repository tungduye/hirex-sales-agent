import {buildAllCampaignExport} from "@/modules/campaigns/server/all-campaign-report-export";
import {buildEmailCampaignResponseExport} from "@/modules/campaigns/server/email-campaign-response-export";

export async function GET(request:Request){
  const searchParams=new URL(request.url).searchParams;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const campaignIds=searchParams.getAll("campaignId").filter(id=>uuid.test(id)).slice(0,100);
  const format=searchParams.get("format")==="csv"?"csv":"xlsx";
  if(format==="xlsx"){
    const result=await buildEmailCampaignResponseExport({campaignIds,q:searchParams.get("q")??"",status:searchParams.get("status")??""});
    if(!result)return new Response("Unauthorized",{status:401});
    if(!result.body)return new Response("No replied recipients in the selected campaigns.",{status:404});
    return new Response(new Uint8Array(result.body),{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="${result.filename}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }
  const result=await buildAllCampaignExport(format);
  if(!result)return new Response("Unauthorized",{status:401});
  return new Response(result.body,{headers:{"Content-Type":result.contentType,"Content-Disposition":`attachment; filename="hirex-campaigns-all-output.${result.extension}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
