import { normalizeCampaignEmail } from "./campaign-rules";

export const AUDIENCE_ROW_LIMIT = 20_000;
export function prepareAudience(rows: unknown[][]) {
  if (rows.length < 2) throw new Error("EMPTY_FILE");
  if (rows.length > AUDIENCE_ROW_LIMIT + 1) throw new Error("ROW_LIMIT");
  if (rows[0].length > 100) throw new Error("COLUMN_LIMIT");
  const aliases: Record<string,string> = {"e-mail":"email","email address":"email","dia chi email":"email","メール":"email","ten ung vien":"name","ho va ten":"name","ten":"name","full_name":"name","ten cong ty":"company","cong ty":"company","chuc vu":"position"};
  const headers=rows[0].map(value=>{const h=String(value??"").replace(/^\uFEFF/,"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").trim().toLowerCase();return aliases[h]??h;});
  if(!headers.includes("email")) throw new Error("MISSING_EMAIL");
  if(headers.filter(Boolean).length!==new Set(headers.filter(Boolean)).size) throw new Error("DUPLICATE_HEADERS");
  const seen=new Set<string>();let invalidEmailRows=0,duplicateRows=0;
  const recipients=[];
  for(const row of rows.slice(1)) {
    const email=normalizeCampaignEmail(row[headers.indexOf("email")]);
    if(!email){invalidEmailRows++;continue;}
    if(seen.has(email)){duplicateRows++;continue;}seen.add(email);
    const value=(key:string)=>String(row[headers.indexOf(key)]??"").trim();
    const custom=Object.fromEntries(headers.map((key,i)=>[key,String(row[i]??"")]).filter(([key])=>key&&!['email','name','company','position','job_title'].includes(key)));
    recipients.push({email,normalized_email:email,display_name:value("name")||null,company:value("company")||null,position:value("position")||value("job_title")||null,personalization_json:custom});
  }
  return {recipients,sourceRows:rows.length-1,validRows:rows.length-1-invalidEmailRows,invalidEmailRows,duplicateRows};
}
