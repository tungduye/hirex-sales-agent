import test from 'node:test';
import assert from 'node:assert/strict';
import {jobIntroduction,nextJobIntroduction,nextScriptJob,salaryFollowup,salaryLabel} from '../src/modules/ai-recruiter/core/recruiter-script.ts';

const vti={external_job_id:'J1',job_title:'BrSE/PM',company_name:'VTI',candidate_type:'BrSE',location:'Hà Nội',salary_range:'55-65M gross',japanese_level_min:'N2',requirements:'Tiếng Nhật N2, trao đổi trực tiếp với khách Nhật',priority:2,sale_stage:'first_job'};
const ntq={external_job_id:'J2',job_title:'BrSE onsite',company_name:'NTQ Japan',candidate_type:'BrSE',location:'Japan',salary_range:'up to 900 man',japanese_level_min:'N2',requirements:'Kinh nghiệm làm việc với khách hàng Nhật',priority:1,sale_stage:'first_job'};
const dev={external_job_id:'J3',job_title:'Java Developer',company_name:'Rikai',candidate_type:'Developer',location:'Hà Nội',salary_range:'30-40M',priority:1};
const all=new Set(['J1','J2','J3']);

test('the first job is in the first place the candidate named, right role',()=>{
 assert.equal(nextScriptJob({candidate_type:'BrSE',location:'Hà Nội',preferred_locations:['Hà Nội','Nhật']},[ntq,vti,dev],[],all),vti);
 assert.equal(nextScriptJob({candidate_type:'BrSE',location:'Nhật'},[ntq,vti,dev],[],all),ntq);
 assert.equal(nextScriptJob({candidate_type:'BrSE',location:'Hà Nội',preferred_locations:['Hà Nội','Nhật']},[ntq,vti],['J1'],all),ntq,'then the next place');
 assert.equal(nextScriptJob({candidate_type:'BrSE',location:'HCM'},[ntq,vti],[],all),null);
});
test('job introduction follows the approved sample',()=>{
 assert.equal(jobIntroduction(vti,{candidate_type:'BrSE'}),'Với kinh nghiệm này em thấy vị trí BrSE/PM tại VTI (Hà Nội, khoảng 55–65 triệu gross) khá sát với anh: vị trí yêu cầu N2 và trao đổi trực tiếp với khách Nhật. Anh đã từng làm BrSE chính, hay kiêm cả phần quản lý dự án ạ?');
 assert.match(jobIntroduction(ntq,{candidate_type:'BrSE'}),/tại NTQ Japan \(Nhật, khoảng up to 900 man\)/);
 assert.match(nextJobIntroduction(ntq),/^Em còn vị trí BrSE onsite tại NTQ Japan \(Nhật/);
});
test('salary is checked against the range before saying it fits',()=>{
 assert.equal(salaryFollowup('60 triệu',vti),'Mức 60 triệu nằm trong range của VTI. Anh dự kiến có thể bắt đầu công việc mới từ thời điểm nào nhé.');
 assert.equal(salaryFollowup('60tr',vti),'Mức 60tr nằm trong range của VTI. Anh dự kiến có thể bắt đầu công việc mới từ thời điểm nào nhé.');
 assert.match(salaryFollowup('80tr',vti),/cao hơn range của VTI \(55–65 triệu gross\)/);
 assert.match(salaryFollowup('800 man',ntq),/nằm trong range của NTQ Japan/);
 assert.match(salaryFollowup('2000 USD',vti),/^Em sẽ trao đổi mức 2000 USD với VTI/);
 assert.equal(salaryLabel('55-65M gross'),'55–65 triệu gross');
});
import {salaryInText,startDateInText} from '../src/modules/ai-recruiter/core/recruiter-script.ts';
test('job title that already names the company is not repeated',()=>{
 assert.match(jobIntroduction({...vti,job_title:'BrSE/PM tại VTI Building'},{candidate_type:'BrSE'}),/^Với kinh nghiệm này em thấy vị trí BrSE\/PM tại VTI Building \(Hà Nội/);
});
test('salary and start date are read from the candidate words',()=>{
 assert.equal(salaryInText('Anh làm BrSE 3 năm, có lead team 5 người. Lương 60tr được không em?'),'60tr');
 assert.equal(salaryInText('mong muốn tầm 800 man'),'800 man');
 assert.equal(salaryInText('anh làm 3 năm rồi'),null);
 const asked='Mức 60tr nằm trong range của VTI. Anh dự kiến có thể bắt đầu công việc mới từ thời điểm nào nhé.';
 assert.equal(startDateInText('Tháng 12 anh nghỉ được',asked),'Tháng 12 anh nghỉ được');
 assert.equal(startDateInText('2 tuần nữa em',asked),'2 tuần nữa em');
 assert.equal(startDateInText('Tháng 12 anh nghỉ được','Anh muốn làm ở đâu ạ'),null);
});
