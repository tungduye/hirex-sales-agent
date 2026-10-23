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
test("hỏi về lương không phải là chê job",()=>{
 for(const text of ["Lương 60tr được không em?","Lương 60tr được không em","lương bên này tầm bao nhiêu em","Anh làm BrSE 3 năm, có lead team 5 người. Lương 60tr được không em?","có làm onsite không em","chưa em"])assert.equal(recruiterRejectionKind(text),"NONE",text);
 for(const text of ["lương thấp quá em","chỗ này xa nhà anh quá","anh không muốn làm onsite","nội dung công việc chưa phù hợp"])assert.equal(recruiterRejectionKind(text),"KNOWN_REASON",text);
 for(const text of ["Job này chưa phù hợp lắm em","anh thấy không hợp lắm"])assert.equal(recruiterRejectionKind(text),"GENERIC",text);
});
