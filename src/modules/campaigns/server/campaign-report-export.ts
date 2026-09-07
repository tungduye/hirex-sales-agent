import "server-only";
import ExcelJS from "exceljs";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import { toSafeCsv } from "@/modules/campaigns/domain/campaign-reporting";
import { sanitizeSpreadsheetCell } from "@/modules/campaigns/domain/sequence-rules";
import { getCanonicalCampaignReport } from "@/modules/campaigns/server/campaign-reporting";

export async function buildCampaignExport(campaignId:string,format:"csv"|"xlsx") {
  const account=await getAccountContext();if(!account?.workspaceId||!account.configurationComplete)return null;
  const db=createPrivilegedSupabaseClient();
  const [report,{data:campaign},{data:recipients},{data:events}]=await Promise.all([getCanonicalCampaignReport(campaignId),
    db.from("email_campaigns").select("id,name,status").eq("id",campaignId).eq("workspace_id",account.workspaceId).maybeSingle(),
    db.from("email_campaign_recipients").select("id,email,display_name,company,position,status,engagement_status,last_sent_step_order,last_engagement_at").eq("campaign_id",campaignId).eq("workspace_id",account.workspaceId),
    db.from("email_campaign_events").select("event_type,recipient_id,created_at").eq("campaign_id",campaignId).eq("workspace_id",account.workspaceId).order("created_at")]);
  if(!campaign||!report)return null;const recipientRows=(recipients??[]).map(r=>[r.email,r.display_name,r.company,r.position,r.status,r.engagement_status,r.last_sent_step_order,r.last_engagement_at]);
  if(format==="csv"){const summary=toSafeCsv(["Metric","Value"],Object.entries(report.campaign));const detail=toSafeCsv(["Email","Name","Company","Position","Delivery status","Engagement","Last step","Last activity"],recipientRows);return {body:Buffer.from(`${summary}\r\n\r\n${detail}`),contentType:"text/csv; charset=utf-8",extension:"csv"}}
  const book=new ExcelJS.Workbook();const add=(name:string,headers:string[],rows:unknown[][])=>{const sheet=book.addWorksheet(name);sheet.addRow(headers);for(const row of rows)sheet.addRow(row.map(sanitizeSpreadsheetCell));sheet.getRow(1).font={bold:true};sheet.views=[{state:"frozen",ySplit:1}];};
  add("Summary",["Metric","Value"],Object.entries(report.campaign));add("Recipients",["Email","Name","Company","Position","Delivery status","Engagement","Last step","Last activity"],recipientRows);
  add("Sequence Steps",["Order","Type","Delay minutes","Eligible","Sent","Failed","Skipped","Delivery unknown","Replies","Reply rate"],report.steps.map(s=>[s.stepOrder,s.stepType,s.delayMinutes,s.eligible,s.sent,s.failed,s.skipped,s.deliveryUnknown,s.repliesAfterStep,s.replyRate]));
  add("Senders",["Account","Campaign daily cap","Campaign minute cap","Global daily cap","Global minute cap","Daily reserved","Minute reserved","Sent","Failed","Delivery unknown","Replies","Hard bounces"],report.senders.map(s=>[s.email,s.campaignDailyCap,s.campaignMinuteCap,s.globalDailyCap,s.globalMinuteCap,s.dailyReserved,s.minuteReserved,s.sent,s.failed,s.deliveryUnknown,s.replies,s.hardBounces]));
  add("Events",["Event","Recipient ID","Created"],(events??[]).map(e=>[e.event_type,e.recipient_id,e.created_at]));
  return {body:Buffer.from(await book.xlsx.writeBuffer()),contentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",extension:"xlsx"};
}
