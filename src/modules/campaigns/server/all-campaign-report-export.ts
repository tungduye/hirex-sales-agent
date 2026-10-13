import "server-only";
import ExcelJS from "exceljs";
import {listCampaigns} from "./campaign-data";
import {toSafeCsv} from "../domain/campaign-reporting";
import {sanitizeSpreadsheetCell} from "../domain/sequence-rules";

const headers=["Tên chiến dịch","Ngày bắt đầu","Số lượng","Combo UV","Vị trí","Xếp hạng kênh","Owner","Nguồn gửi đi","Trạng thái"];

export async function buildAllCampaignExport(format:"csv"|"xlsx"){
  const {campaigns,error}=await listCampaigns();
  if(error)return null;
  const rows=campaigns.map(c=>[c.name,c.startedAt??"",c.sent,c.comboUv??"",c.placement??"",c.channelRank??"",c.ownerName??"",c.senderEmails.join(", "),c.status]);
  if(format==="csv")return {body:Buffer.from(toSafeCsv(headers,rows)),contentType:"text/csv; charset=utf-8",extension:"csv"};
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("Tổng hợp chiến dịch");sheet.addRow(headers);for(const row of rows)sheet.addRow(row.map(sanitizeSpreadsheetCell));sheet.getRow(1).font={bold:true};sheet.views=[{state:"frozen",ySplit:1}];for(const column of sheet.columns)column.width=24;
  return {body:Buffer.from(await book.xlsx.writeBuffer()),contentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",extension:"xlsx"};
}
