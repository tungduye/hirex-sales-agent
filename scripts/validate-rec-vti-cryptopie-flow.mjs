import { aiRecruiterPersonaPolicies, aiRecruiterSharedPolicy } from "../src/modules/ai-recruiter/core/persona-policy.ts";

const apiKey=process.env.OPENAI_API_KEY;
if(!apiKey)throw new Error("OPENAI_API_KEY is required");
const jobs=[
  {job_id:"VTI_BRSE_01",company_name:"VTI",sale_stage:"first_job",location:"Mễ Trì Hạ, Hà Nội",job_title:"BrSE",requirements:"Tiếng Nhật N1/N2, có kinh nghiệm làm việc tại Nhật",priority:1},
  {job_id:"CRYPTOPIE_PM_02",company_name:"Cryptopie",sale_stage:"second_job",location:"Rox Center, 316 Hồ Tùng Mậu, Hà Nội",job_title:"PM/BrSE",requirements:"Tiếng Nhật tốt, kinh nghiệm cầu nối hoặc làm việc tại Nhật",priority:2},
];
const messages=["hi em","Anh đang theo hướng BrSE","anh đang ưu tiên làm tại Hà Nội","tiếng nhật của anh đang N1, anh sang Nhật làm việc được 4 năm sau đó về nước","Job này anh từng apply nhưng fail rồi nên anh không avai lắm","Job này cũng chưa phù hợp em ạ"];
const transcript=[];
let state={offered:[],rejected:[],stage:"greeting",stopped:false};
const system=`${aiRecruiterPersonaPolicies.RECRUITER} ${aiRecruiterSharedPolicy}
Quy tắc test bắt buộc: mở đầu tự nhiên rồi lần lượt hỏi đúng một cụm còn thiếu: hướng, địa điểm, tiếng Nhật và số năm ở Nhật. Khi đủ ba cụm, giới thiệu job priority=1. Nếu ứng viên nói đã apply hoặc fail job vừa gửi, không hỏi lý do và chuyển ngay sang job priority=2. Nếu ứng viên từ chối job priority=2, không gửi job khác; báo đang dùng điện thoại chưa tiện kiểm tra thêm, sẽ xem dự án sát hơn rồi gửi sau, đặt stopBot=true và notification="NOTI_3". Không lặp job đã từ chối. Trả JSON.`;
const schema={type:"object",additionalProperties:false,required:["reply","selectedJobId","stage","stopBot","notification","rejectedJobIds"],properties:{reply:{type:"string"},selectedJobId:{type:["string","null"]},stage:{type:"string"},stopBot:{type:"boolean"},notification:{type:["string","null"]},rejectedJobIds:{type:"array",items:{type:"string"}}}};
for(const latestInbound of messages){
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-5.6-terra",store:false,max_output_tokens:500,instructions:system,input:JSON.stringify({jobs,state,transcript,latestInbound}),text:{format:{type:"json_schema",name:"rec_flow_test",strict:true,schema}}}),signal:AbortSignal.timeout(45_000)});
  if(!response.ok)throw new Error(`OpenAI HTTP ${response.status}`);
  const json=await response.json(),raw=(json.output??[]).flatMap(item=>item.content??[]).filter(part=>part.type==="output_text").map(part=>part.text).join("");
  const result=JSON.parse(raw);
  transcript.push({user:latestInbound,bot:result.reply,selectedJobId:result.selectedJobId,stage:result.stage,stopBot:result.stopBot,notification:result.notification});
  state={offered:[...new Set([...state.offered,...(result.selectedJobId?[result.selectedJobId]:[])])],rejected:[...new Set([...state.rejected,...result.rejectedJobIds])],stage:result.stage,stopped:result.stopBot};
}
const firstOffer=transcript.find(turn=>turn.selectedJobId),secondOffer=transcript.filter(turn=>turn.selectedJobId)[1],last=transcript.at(-1);
const checks={
  caseA:firstOffer?.selectedJobId==="VTI_BRSE_01"&&/VTI|Mễ Trì Hạ/iu.test(firstOffer.bot),
  caseB:secondOffer?.selectedJobId==="CRYPTOPIE_PM_02"&&/Cryptopie|Rox Center/iu.test(secondOffer.bot)&&!/VTI/iu.test(secondOffer.bot),
  caseC:last?.selectedJobId===null&&last?.stopBot===true&&last?.notification==="NOTI_3"&&/điện thoại|check|kiểm tra|xem thêm/iu.test(last.bot),
  oneQuestionPerTurn:transcript.every(turn=>(turn.bot.match(/[?？]/gu)??[]).length<=1),
  noMechanicalAcknowledgement:transcript.every(turn=>!/em (?:đã )?ghi nhận|dạ em hiểu|em hiểu rồi/iu.test(turn.bot)),
};
console.log(JSON.stringify({transcript,checks,pass:Object.values(checks).every(Boolean)},null,2));
if(!Object.values(checks).every(Boolean))process.exitCode=1;
