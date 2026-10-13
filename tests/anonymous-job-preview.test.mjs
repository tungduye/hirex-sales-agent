import test from 'node:test';
import assert from 'node:assert/strict';
import {anonymousJobPreviews,containsJobDisclosure} from '../src/modules/ai-recruiter/core/anonymous-job-preview.ts';
import {aiRecruiterPersonaPolicy} from '../src/modules/ai-recruiter/core/persona-policy.ts';
const jobs=[{external_job_id:'1',company_name:'VTI',job_title:'BrSE tại VTI Building',candidate_type:'BrSE',location:'Hà Nội',salary_range:'55–65M gross',jd_link:'https://example.com/jd',summary:'Trao đổi yêu cầu với khách Nhật. VTI có văn phòng lớn.',requirements:['Giao tiếp tiếng Nhật','Lương 55–65M gross']}];
test('anonymous preview retains only sourced duties and requirements',()=>{
 const [preview]=anonymousJobPreviews(jobs);
 assert.equal(preview.summary,'Trao đổi yêu cầu với khách Nhật.');
 assert.deepEqual(preview.requirements,['Giao tiếp tiếng Nhật']);
 for(const key of ['company_name','job_title','salary_range','jd_link'])assert.equal(preview[key],undefined);
 assert.equal(containsJobDisclosure(JSON.stringify(preview),jobs),false);
});
test('useful anonymous reply passes; employer, compensation and links do not',()=>{
 assert.equal(containsJobDisclosure('Em có vị trí BrSE tại Hà Nội, trao đổi yêu cầu với khách Nhật.',jobs),false);
 for(const text of ['Công ty VTI','55–65M gross','https://example.com/jd','Lương 60 triệu'])assert.equal(containsJobDisclosure(text,jobs),true);
});
test('empty catalogue creates no invented job',()=>assert.deepEqual(anonymousJobPreviews([]),[]));
test('persona allows advice without compulsory questioning and retains disclosure gate',()=>{
 const policy=aiRecruiterPersonaPolicy('RECRUITER');
 assert.match(policy,/không bắt buộc hỏi mỗi lượt/);
 assert.match(policy,/được giới thiệu ẩn danh/);
 assert.match(policy,/số năm sống\/làm việc tại Nhật/);
});
