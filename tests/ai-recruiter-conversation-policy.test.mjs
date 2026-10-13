import assert from "node:assert/strict";
import test from "node:test";
import { recruiterRejectionKind, recruiterRejectionOverride } from "../src/modules/ai-recruiter/core/recruiter-conversation-policy.ts";

test("apply/fail là từ chối có lý do",()=>assert.equal(recruiterRejectionKind("Job này anh từng apply nhưng fail rồi"),"KNOWN_REASON"));
test("từ chối job 1 chung chung phải hỏi lý do",()=>assert.deepEqual(recruiterRejectionOverride({text:"Job này chưa phù hợp lắm em",lastSaleStage:"first_job"}),{reply:"Job này chưa hợp ở phần địa điểm, lương hay nội dung công việc vậy anh, để em lọc job khác sát hơn nhé.",stopBot:false,notification:null}));
test("từ chối job 2 phải Noti 3 và dừng",()=>assert.deepEqual(recruiterRejectionOverride({text:"Job này cũng chưa phù hợp em ạ",lastSaleStage:"second_job"}),{reply:"Vậy hả anh ơi, hiện em đang online điện thoại nên chưa tiện kiểm tra thêm hệ thống được. Anh đợi em xem thêm dự án sát hơn rồi gửi anh sau ạ.",stopBot:true,notification:"NOTI_3"}));
