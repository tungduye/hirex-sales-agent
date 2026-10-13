import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedIntroReply,withoutQuestionMarks} from '../src/modules/ai-recruiter/core/approved-intro-flow.ts';
const jobs=['Hà Nội','Hồ Chí Minh','Japan'].map(location=>({candidate_type:'BrSE',location,requirements:'BrSE/PM, tiếng Nhật tốt, có khả năng trao đổi khách Nhật'}));
test('lists only verified locations',()=>{
 assert.match(approvedIntroReply({candidate_type:'BrSE'},jobs),/Hà Nội, HCM và Nhật/);
 assert.doesNotMatch(approvedIntroReply({candidate_type:'BrSE'},jobs.slice(0,1)),/HCM|Nhật/);
});
test('approved Hanoi combined question is exact',()=>assert.equal(approvedIntroReply({candidate_type:'BrSE',location:'Hà Nội'},jobs),'Em có vị trí BrSE tại Hà Nội, cần người có thể trao đổi công việc với khách Nhật.\n\nHiện anh sử dụng tiếng Nhật trong công việc thế nào ạ. Anh chia sẻ thêm giúp em thời gian từng sống hoặc làm việc bên Nhật nhé'));
test('partial answers ask only the missing fact; zero years completes profile',()=>{
 assert.doesNotMatch(approvedIntroReply({candidate_type:'BrSE',location:'Hà Nội',japanese_level:'N2'},jobs),/sử dụng tiếng Nhật/);
 assert.doesNotMatch(approvedIntroReply({candidate_type:'BrSE',location:'Hà Nội',japan_years:0},jobs),/bên Nhật/);
 assert.equal(approvedIntroReply({candidate_type:'BrSE',location:'Hà Nội',japanese_level:'N2',japan_years:0},jobs),null);
});
test('no invented vacancy or requirement',()=>{
 assert.match(approvedIntroReply({candidate_type:'BrSE',location:'Hà Nội'},[]),/chưa thấy/);
 assert.doesNotMatch(approvedIntroReply({candidate_type:'BrSE',location:'Hà Nội'},[{...jobs[0],requirements:''}]),/khách Nhật/);
});
test('question punctuation removed including opening',()=>assert.equal(withoutQuestionMarks('Anh ạ? Anh nhé？？'),'Anh ạ. Anh nhé.'));
