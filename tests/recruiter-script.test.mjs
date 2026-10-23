import test from 'node:test';
import assert from 'node:assert/strict';
import {appliedAnswer,CV_CLOSING,cvClosing,cvRequest,jobIntroduction,nextJobIntroduction,nextScriptJob,NO_CV_REPLY,processPitch,salaryFollowup,salaryLabel,startFollowup} from '../src/modules/ai-recruiter/core/recruiter-script.ts';

const vti={external_job_id:'J1',job_title:'BrSE/PM',company_name:'VTI',candidate_type:'BrSE',location:'Hà Nội',salary_range:'55-65M gross',japanese_level_min:'N2',requirements:'Tiếng Nhật N2, trao đổi trực tiếp với khách Nhật',priority:2,sale_stage:'first_job'};
const ntq={external_job_id:'J2',job_title:'BrSE onsite',company_name:'NTQ Japan',candidate_type:'BrSE',location:'Japan',salary_range:'up to 900 man',japanese_level_min:'N2',requirements:'Kinh nghiệm làm việc với khách hàng Nhật',priority:1,sale_stage:'first_job'};
const dev={external_job_id:'J3',job_title:'Java Developer',company_name:'Rikai',candidate_type:'Developer',location:'Hà Nội',salary_range:'30-40M',priority:1};
const all=new Set(['J1','J2','J3']);
const vtiFull={...vti,job_title:'BrSE/PM tại VTI Building',process_summary:'Process gọn, có thể trao đổi nhanh nếu profile sát',rank_salary_note:'Rank lương tốt cho BrSE/PM',summary:'Công ty hơn 2000 nhân sự, văn phòng riêng tại VTI Building'};
const crypto={external_job_id:'J4',job_title:'PM/BrSE level quản lý',company_name:'Cryptopie',candidate_type:'PM',location:'Hà Nội',salary_range:'60-70M gross',summary:'Công ty Nhật, văn phòng tại Singapore, đang tìm level quản lý'};

test('the first job is in the first place the candidate named, right role',()=>{
 assert.equal(nextScriptJob({candidate_type:'BrSE',location:'Hà Nội',preferred_locations:['Hà Nội','Nhật']},[ntq,vti,dev],[],all),vti);
 assert.equal(nextScriptJob({candidate_type:'BrSE',location:'Nhật'},[ntq,vti,dev],[],all),ntq);
 assert.equal(nextScriptJob({candidate_type:'BrSE',location:'Hà Nội',preferred_locations:['Hà Nội','Nhật']},[ntq,vti],['J1'],all),ntq,'then the next place');
 assert.equal(nextScriptJob({candidate_type:'BrSE',location:'HCM'},[ntq,vti],[],all),null);
});
test('job introduction follows the Rec team sample: company, place, facts, rank, salary, then "đã apply chưa"',()=>{
 const intro=jobIntroduction(vtiFull,{candidate_type:'BrSE',japanese_level:'N2',japan_years:5});
 assert.equal(intro,'Dạ với tiếng Nhật N2 và 5 năm sống và làm việc bên Nhật thì em đang có một job khá sát với anh ạ.\n\nEm đang có job của VTI ở Hà Nội, công ty hơn 2000 nhân sự, văn phòng riêng tại VTI Building, đợt này công ty lấy rank BrSE/PM lương tầm 55–65 triệu gross anh ạ. Anh đã từng apply công ty này chưa ạ?');
 assert.match(jobIntroduction(ntq,{candidate_type:'BrSE'}),/^Dạ vâng anh ạ\.\n\nEm đang có job của NTQ Japan ở Nhật, đợt này công ty lấy rank BrSE onsite lương lên tới 900 man anh ạ\./);
 assert.match(jobIntroduction({...vti,job_title:'BrSE/PM tại VTI Building'},{}),/job của VTI ở VTI Building, Hà Nội,/,'the building when the facts do not name it');
 assert.match(nextJobIntroduction(crypto),/^Vâng anh ơi, để em check bên dự án một chút\. Nay em thấy có 1 job của Cryptopie ở Hà Nội, công ty Nhật, văn phòng tại Singapore, đang tìm level quản lý, bên này lấy rank PM\/BrSE level quản lý lương tầm 60–70 triệu gross anh ạ\. Anh từng biết bên này chưa/);
});
test('the answer to "đã apply chưa"',()=>{
 const asked='Em đang có job của VTI ở Hà Nội. Anh đã từng apply công ty này chưa ạ.';
 for(const text of ['rồi em','Rồi','anh apply rồi','anh từng apply bên này nhưng fail','đã phỏng vấn rồi'])assert.equal(appliedAnswer(text,asked),'applied',text);
 for(const text of ['chưa em','Chưa','anh chưa apply bao giờ','k em','không, chưa từng','biết rồi nhưng chưa apply'])assert.equal(appliedAnswer(text,asked),'not_applied',text);
 assert.equal(appliedAnswer('lương bao nhiêu em',asked),null);
 for(const text of ['job này chưa phù hợp lắm em','anh không quan tâm lắm'])assert.equal(appliedAnswer(text,asked),null,text);
 assert.equal(appliedAnswer('rồi em','Anh muốn làm ở đâu ạ'),null,'only right after the question');
 assert.equal(appliedAnswer('chưa','Anh từng biết bên này chưa để em giới thiệu thêm đến anh ạ.'),'not_applied');
});
test('process pitch uses only the job data, then asks salary and start together',()=>{
 assert.equal(processPitch(vtiFull),'Vâng anh, bên VTI process gọn, có thể trao đổi nhanh nếu profile sát anh ạ. Anh expect lương khoảng nào và nếu đáp ứng được thì lúc nào anh sang được ạ?');
 assert.equal(processPitch(vti),'Vâng anh, em giới thiệu thêm job này cho anh ạ. Anh expect lương khoảng nào và nếu đáp ứng được thì lúc nào anh sang được ạ?');
});
test('salary is checked against the range before saying it fits',()=>{
 assert.equal(salaryFollowup('60tr',vti),'Dạ, mức 60tr nằm trong khung lương bên VTI đang lấy (55–65 triệu gross) anh ạ. Nếu đáp ứng được mức này thì khoảng lúc nào anh có thể sang được ạ?');
 assert.match(salaryFollowup('80tr',vti),/cao hơn khung bên VTI đang lấy \(55–65 triệu gross\) một chút/);
 assert.match(salaryFollowup('800 man',ntq),/nằm trong khung lương bên NTQ Japan/);
 assert.match(salaryFollowup('2000 USD',vti),/mức 2000 USD em sẽ trao đổi lại với bên VTI/);
 assert.equal(salaryLabel('55-65M gross'),'55–65 triệu gross');
 assert.match(startFollowup(vti),/Anh expect mức lương khoảng bao nhiêu để em trao đổi với bên VTI/);
});
test('CV request: salary note from the job data, CV hiện tại hoặc CV cũ',()=>{
 assert.equal(cvRequest(vtiFull,'60tr'),'Vâng anh ạ, mức 60tr nằm trong khung lương bên VTI đang lấy (55–65 triệu gross) anh ạ. Đợt này bên VTI rank lương tốt cho BrSE/PM anh ạ. Anh có sẵn CV hiện tại hoặc CV cũ không ạ, gửi giúp em qua đây để em gửi cho PM dự án bên em ạ?');
 assert.equal(cvRequest(vti,null),'Vâng anh ạ. Anh có sẵn CV hiện tại hoặc CV cũ không ạ, gửi giúp em qua đây để em gửi cho PM dự án bên em ạ?','no invented salary claim');
 for(const text of [NO_CV_REPLY,CV_CLOSING])assert.doesNotMatch(text,/điện thoại|lịch off|hệ thống/u);
});
import {salaryInText,startDateInText} from '../src/modules/ai-recruiter/core/recruiter-script.ts';
test('salary and start date are read from the candidate words',()=>{
 assert.equal(salaryInText('Anh làm BrSE 3 năm, có lead team 5 người. Lương 60tr được không em?'),'60tr');
 assert.equal(salaryInText('mong muốn tầm 800 man'),'800 man');
 assert.equal(salaryInText('anh làm 3 năm rồi'),null);
 const asked='Dạ, mức 60tr nằm trong khung lương bên VTI đang lấy (55–65 triệu gross) anh ạ. Nếu đáp ứng được mức này thì khoảng lúc nào anh có thể sang được ạ.';
 assert.equal(startDateInText('Tháng 12 anh nghỉ được',asked),'Tháng 12 anh nghỉ được');
 assert.equal(startDateInText('2 tuần nữa em',asked),'2 tuần nữa em');
 assert.equal(startDateInText('Tháng 12 anh nghỉ được','Anh muốn làm ở đâu ạ'),null);
});
test('start date after the Rec question',()=>{
 const asked='Vâng anh, bên VTI process gọn anh ạ. Anh expect lương khoảng nào và nếu đáp ứng được thì lúc nào anh sang được ạ.';
 assert.equal(startDateInText('Anh có thể làm được đầu năm sau',asked),'Anh có thể làm được đầu năm sau');
 assert.equal(salaryInText('60tr, tháng 12 anh sang được'),'60tr');
 assert.equal(startDateInText('60tr, tháng 12 anh sang được',asked),'60tr, tháng 12 anh sang được');
});
test('closing answers a JD request',()=>{
 assert.equal(cvClosing(vti,false),CV_CLOSING);
 assert.match(cvClosing({...vti,jd_link:'https://jd.example/vti'},true),/JD chi tiết của vị trí này anh xem ở đây ạ: https:\/\/jd\.example\/vti/);
 assert.match(cvClosing(vti,true),/JD chi tiết của vị trí này em gửi anh ngay sau đây ạ/);
});
