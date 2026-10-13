import ExcelJS from "exceljs";
import { z } from "zod";
import { hasPermission } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export const runtime = "nodejs";

const rowSchema = z.object({ companyName:z.string(),website:z.string(),domain:z.string(),status:z.string(),companyType:z.string(),headhuntScore:z.number().nullable(),priority:z.string(),foundedYear:z.string().default(""),ceo:z.string().default(""),legalRepresentative:z.string().default(""),charterCapital:z.string().default(""),ownershipNationality:z.string().default(""),headquarters:z.string().default(""),employeeCount:z.string().default(""),legalProfile:z.string(),operationsAndHiring:z.string(),headhuntAssessment:z.string(),emails:z.object({primary:z.string(),hr:z.array(z.string()),sales:z.array(z.string()),general:z.array(z.string()),other:z.array(z.string())}),phones:z.array(z.string()),linkedIn:z.string(),facebook:z.string(),pagesCrawled:z.number(),sources:z.array(z.string()),error:z.string() }).passthrough();

export async function POST(request: Request) {
  const account = await getAccountContext();
  if (!account?.workspaceId || !await hasPermission("scan.export")) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const rows = z.array(rowSchema).max(100).parse(await request.json());
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Kết quả Scan Website", { views: [{ state:"frozen", ySplit:1 }] });
  const columns: Array<[string,string,number]> = [
    ["Tên công ty","companyName",28],["Website","website",34],["Domain","domain",24],["Trạng thái","status",14],["Loại hình công ty","companyType",24],["Điểm headhunt","headhuntScore",15],["Ưu tiên","priority",15],["Năm thành lập","foundedYear",18],["CEO/Tổng giám đốc","ceo",28],["Đại diện pháp luật","legalRepresentative",28],["Vốn điều lệ","charterCapital",22],["Quốc gia/Nguồn vốn","ownershipNationality",24],["Trụ sở","headquarters",38],["Quy mô nhân sự","employeeCount",20],["Hồ sơ pháp lý và vốn","legalProfile",55],["Quy mô và tuyển dụng","operationsAndHiring",55],["Đánh giá headhunt","headhuntAssessment",55],["Bản phân tích đầy đủ","fullReport",100],["Nhóm quan hệ","businessRelationship",30],["Nguồn liên hệ","contactSources",60],["Email chính","primaryEmail",28],["Email HR","hrEmails",35],["Email Sales","salesEmails",35],["Email chung","generalEmails",35],["Email khác","otherEmails",35],["Điện thoại","phones",25],["LinkedIn","linkedIn",32],["Facebook","facebook",32],["Số trang đã quét","pagesCrawled",16],["Nguồn","sources",55],["Lỗi","error",35],
  ];
  sheet.columns = columns.map(([header,key,width])=>({header,key,width}));
  for (const row of rows) sheet.addRow({ ...row, contactSources:Array.isArray(row.contactEvidence)?row.contactEvidence.map((item:{value:string;source:string})=>`${item.value}: ${item.source}`).join("\n"):"", primaryEmail:row.emails.primary, hrEmails:row.emails.hr.join("; "), salesEmails:row.emails.sales.join("; "), generalEmails:row.emails.general.join("; "), otherEmails:row.emails.other.join("; "), phones:row.phones.join("; "), sources:row.sources.join("\n") });
  sheet.getRow(1).eachCell((cell)=>{cell.font={bold:true,color:{argb:"FFFFFFFF"}};cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF1D4ED8"}};cell.alignment={vertical:"middle",wrapText:true};});
  sheet.eachRow((row,index)=>{if(index>1)row.eachCell((cell)=>{cell.alignment={vertical:"top",wrapText:true};});});
  sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:columns.length}};
  const body = Buffer.from(await book.xlsx.writeBuffer());
  return new Response(body,{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="HireX_Scan_Website_${new Date().toISOString().slice(0,10)}.xlsx"`,"Cache-Control":"private, no-store"}});
}
