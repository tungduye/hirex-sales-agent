import { aiRecruiterPersonaPolicies, aiRecruiterSharedPolicy } from "../src/modules/ai-recruiter/core/persona-policy.ts";

const apiKey=process.env.OPENAI_API_KEY;
if(!apiKey)throw new Error("OPENAI_API_KEY is required");
const jobs=[
  {external_job_id:"TEST-01",company_name:"Công ty Alpha",job_title:"BrSE",candidate_type:"BrSE",location:"Hà Nội",japanese_level_min:"N2",salary_range:"50-65M gross",requirements:"Có kinh nghiệm cầu nối khách hàng Nhật"},
  {external_job_id:"TEST-02",company_name:"Công ty Beta",job_title:"Senior BrSE",candidate_type:"BrSE",location:"Hà Nội",japanese_level_min:"N2",salary_range:"55-70M gross",requirements:"Từ 3 năm kinh nghiệm BrSE hoặc cầu nối khách hàng Nhật"},
];
const stages=[
  {stage_key:"role",stage_name:"Vị trí",next_stage:"experience"},
  {stage_key:"experience",stage_name:"Kinh nghiệm",next_stage:"salary"},
  {stage_key:"salary",stage_name:"Thu nhập",next_stage:"availability"},
  {stage_key:"availability",stage_name:"Thời điểm",next_stage:"cv"},
  {stage_key:"cv",stage_name:"CV",next_stage:null},
];

const userTurns=[
  "Chào em, anh đang tìm job BrSE ở Hà Nội.",
  "Anh có N2 và đã làm cầu nối với khách hàng Nhật 3 năm rồi em nhé.",
  "Anh mong muốn mức khoảng 55-60M gross.",
  "Anh có thể bắt đầu sau 30 ngày.",
  "Anh từng phỏng vấn Công ty Alpha nhưng không phù hợp nên không muốn ứng tuyển lại bên đó.",
];
const transcript=[],known=[];
for(const user of userTurns){
  known.push(user);
  const prompt={jobs,stages,knownCandidateMessages:known,conversation:transcript,latestInbound:user};
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-5.6-terra",store:false,max_output_tokens:350,instructions:`${aiRecruiterPersonaPolicies.RECRUITER} ${aiRecruiterSharedPolicy} Chỉ dùng job trong dữ liệu. Mỗi lượt hỏi tối đa một dữ kiện chưa có. Không dùng dấu hỏi. Khi ứng viên từ chối một công ty, không xác nhận máy móc và nếu còn job phù hợp khác thì giới thiệu ngay đúng một job tiếp theo. Mỗi câu trả lời không quá 240 ký tự. Trả duy nhất tin nhắn gửi ứng viên.`,input:JSON.stringify(prompt)}),signal:AbortSignal.timeout(45_000)});
  if(!response.ok)throw new Error(`OpenAI HTTP ${response.status}`);
  const json=await response.json(),assistant=(json.output??[]).flatMap(item=>item.content??[]).filter(part=>part.type==="output_text").map(part=>part.text).join("").trim();
  const pass=Boolean(assistant)&&assistant.length<=260&&(assistant.match(/[?？]/gu)??[]).length<=1&&!/em (?:đã )?ghi nhận|dạ em hiểu|em hiểu rồi/iu.test(assistant);
  transcript.push({user,assistant,pass});
}
const rejectedTurn=transcript.at(-1)?.assistant??"";
const flowPass=transcript.every(turn=>turn.pass)&&!/Alpha/iu.test(rejectedTurn)&&/Beta|Senior BrSE|vị trí phù hợp/iu.test(rejectedTurn);
console.log(JSON.stringify({bot:"Recruiter test sandbox",jobs:jobs.map(job=>({company:job.company_name,title:job.job_title,location:job.location,salary:job.salary_range})),transcript,flowPass},null,2));
if(!flowPass)process.exitCode=1;
