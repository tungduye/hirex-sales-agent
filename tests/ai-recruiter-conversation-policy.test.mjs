import assert from "node:assert/strict";
import test from "node:test";
import { recruiterRejectionKind, recruiterRejectionOverride } from "../src/modules/ai-recruiter/core/recruiter-conversation-policy.ts";

test("apply/fail là từ chối có lý do",()=>assert.equal(recruiterRejectionKind("Job này anh từng apply nhưng fail rồi"),"KNOWN_REASON"));
test("từ chối job 1 chung chung phải hỏi lý do",()=>assert.deepEqual(recruiterRejectionOverride({text:"Job này chưa phù hợp lắm em",lastSaleStage:"first_job"}),{reply:"Dạ vâng anh, anh thấy job này chưa hợp ở phần địa điểm, mức lương hay nội dung công việc ạ. Anh chia sẻ giúp em để em lọc job khác sát với anh hơn nha.",stopBot:false,notification:null}));
test("từ chối job 2 phải Noti 3 và dừng",()=>assert.deepEqual(recruiterRejectionOverride({text:"Job này cũng chưa phù hợp em ạ",lastSaleStage:"second_job"}),{reply:"Vậy hả anh ơi, để em check thêm các dự án phù hợp với anh rồi em gửi anh sớm nha. Em cám ơn anh đã dành thời gian trao đổi với em ạ.",stopBot:true,notification:"NOTI_3"}));
test("trả lời \"rồi\" cho câu đã apply chưa ở job 2 thì dừng, không viện cớ",()=>{
 const stop=recruiterRejectionOverride({text:"rồi em",lastSaleStage:"second_job",kind:"KNOWN_REASON"});
 assert.equal(stop.stopBot,true);
 assert.doesNotMatch(stop.reply,/điện thoại|hệ thống|lịch off/u);
});
