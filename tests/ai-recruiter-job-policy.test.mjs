import assert from "node:assert/strict";
import test from "node:test";
import { availabilityFollowup, candidateExplicitlyHasNoCv, candidateExplicitlyLacksManagement, eligibleRecruiterJobIds, hasRecruiterCvAttachment } from "../src/modules/ai-recruiter/server/ai-recruiter-job-policy.ts";

const jobs=[
  {external_job_id:"HCM_BRSE_03",company_name:"Namitech",requirements:"PM/BrSE, quản lý dự án",summary:"Tìm level quản lý",selling_points:"Role quản lý"},
  {external_job_id:"HCM_BRSE_04",company_name:"Sabitech",requirements:"BrSE/PM, tiếng Nhật tốt, trao đổi khách Nhật",summary:"",selling_points:""},
];

test("nhận diện phủ định kinh nghiệm quản lý",()=>{assert.equal(candidateExplicitlyLacksManagement("Chưa từng quản lý dự án"),true);assert.equal(candidateExplicitlyLacksManagement("Có 2 năm quản lý dự án"),false)});
test("loại job quản lý và giữ job BrSE",()=>{const eligible=eligibleRecruiterJobIds(jobs,new Set(),"Chưa từng quản lý dự án");assert.equal(eligible.has("HCM_BRSE_03"),false);assert.equal(eligible.has("HCM_BRSE_04"),true)});
test("loại công ty đã từ chối",()=>{const eligible=eligibleRecruiterJobIds(jobs,new Set(["sabitech"]),"Có 2 năm quản lý dự án");assert.equal(eligible.has("HCM_BRSE_03"),true);assert.equal(eligible.has("HCM_BRSE_04"),false)});
test("hỏi thời điểm nhận việc trước CV",()=>{const reply=availabilityFollowup("65M gross",null,"Sabitech");assert.match(reply,/bắt đầu công việc mới/u);assert.doesNotMatch(reply,/CV/iu);assert.equal(availabilityFollowup("65M gross","Sau 30 ngày","Sabitech"),null)});
test("không coi việc nhắc đến CV là đã nhận CV",()=>{assert.equal(hasRecruiterCvAttachment({attachments:[]}),false);assert.equal(candidateExplicitlyHasNoCv("Anh chưa chuẩn bị CV, cuối tuần anh gửi em được không"),true)});
test("chỉ xác nhận CV khi có tệp CV đính kèm",()=>{assert.equal(hasRecruiterCvAttachment({attachments:[{filename:"CV_Nguyen_Van_A.pdf"}]}),true);assert.equal(hasRecruiterCvAttachment({attachments:[{filename:"anh_chan_dung.jpg"}]}),false)});
