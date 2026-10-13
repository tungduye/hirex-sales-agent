import { aiRecruiterPersonaPolicies, aiRecruiterSharedPolicy } from "../src/modules/ai-recruiter/core/persona-policy.ts";

const apiKey=process.env.OPENAI_API_KEY;
if(!apiKey)throw new Error("OPENAI_API_KEY is required");

const cases=[
  {type:"SALE",message:"Bên anh cần tuyển 8 Java Developer trong quý này",must:/bao nhiêu|thời gian|thời hạn|mốc|ngân sách|địa điểm|yêu cầu/iu,forbid:/gửi.*CV|tìm việc|ứng viên đang quan tâm/iu},
  {type:"RECRUITER",message:"Anh tìm job BrSE ở Hà Nội, có N2 và 3 năm cầu nối khách Nhật",must:/kinh nghiệm|mức|thu nhập|thời điểm|CV|Hà Nội|BrSE/iu,forbid:/ngân sách tuyển|bên anh cần tuyển bao nhiêu/iu},
  {type:"COLLABORATOR",message:"Anh là CTV, muốn gửi một ứng viên Java cho job đang tuyển",must:/mã|thông tin CTV|job|hồ sơ|ứng viên|CV/iu,forbid:/mức lương mong muốn của anh|anh đang tìm job/iu},
  {type:"INTERNAL_HR",message:"Anh là nhân viên, muốn hỏi thủ tục nghỉ phép",must:/mã nhân viên|email công ty|nghỉ phép|chính sách|HR/iu,forbid:/gửi CV|job phù hợp|ngân sách tuyển/iu},
];

const results=[];
for(const test of cases){
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-5.6-terra",store:false,max_output_tokens:300,instructions:`${aiRecruiterPersonaPolicies[test.type]} ${aiRecruiterSharedPolicy} Trả lời duy nhất nội dung tin nhắn, không giải thích.`,input:test.message}),signal:AbortSignal.timeout(45_000)});
  if(!response.ok)throw new Error(`${test.type}: OpenAI HTTP ${response.status}`);
  const json=await response.json();
  const text=(json.output??[]).flatMap(item=>item.content??[]).filter(part=>part.type==="output_text").map(part=>part.text).join("").trim();
  const questions=(text.match(/[?？]/gu)??[]).length;
  const pass=Boolean(text)&&test.must.test(text)&&!test.forbid.test(text)&&!/em (?:đã )?ghi nhận|dạ em hiểu|em hiểu rồi/iu.test(text)&&questions<=1&&text.length<=320;
  results.push({type:test.type,pass,text});
}
console.log(JSON.stringify(results,null,2));
if(results.some(result=>!result.pass))process.exitCode=1;
