import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedIntroReply,withoutQuestionMarks} from '../src/modules/ai-recruiter/core/approved-intro-flow.ts';
const jobs=['Hà Nội','Hồ Chí Minh','Japan'].map(location=>({candidate_type:'BrSE',location,requirements:'BrSE/PM, tiếng Nhật tốt, có khả năng trao đổi khách Nhật'}));
test('lists only verified locations',()=>{
 assert.match(approvedIntroReply({candidate_type:'BrSE'},jobs),/Hà Nội, HCM và Nhật/);
 assert.doesNotMatch(approvedIntroReply({candidate_type:'BrSE'},jobs.slice(0,1)),/HCM|Nhật/);
});
test('Hanoi combined question is full and polite',()=>assert.equal(approvedIntroReply({candidate_type:'BrSE',location:'Hà Nội'},jobs),'Dạ ở Hà Nội bên em đang có vị trí BrSE, công việc cần trao đổi trực tiếp với khách Nhật anh ạ.\n\nĐể em giới thiệu job sát nhất với anh, anh cho em hỏi hiện anh dùng tiếng Nhật ở mức nào và đã từng sống hoặc làm việc bên Nhật bao lâu rồi ạ.'));
test('partial answers ask only the missing fact; zero years completes profile',()=>{
 assert.doesNotMatch(approvedIntroReply({candidate_type:'BrSE',location:'Hà Nội',japanese_level:'N2'},jobs),/tiếng Nhật ở mức nào/);
 assert.doesNotMatch(approvedIntroReply({candidate_type:'BrSE',location:'Hà Nội',japan_years:0},jobs),/bên Nhật/);
 assert.equal(approvedIntroReply({candidate_type:'BrSE',location:'Hà Nội',japanese_level:'N2',japan_years:0},jobs),null);
});
test('no invented vacancy or requirement',()=>{
 assert.match(approvedIntroReply({candidate_type:'BrSE',location:'Hà Nội'},[]),/chưa thấy/);
 assert.doesNotMatch(approvedIntroReply({candidate_type:'BrSE',location:'Hà Nội'},[{...jobs[0],requirements:''}]),/khách Nhật/);
});
test('question punctuation removed including opening',()=>assert.equal(withoutQuestionMarks('Anh ạ? Anh nhé？？'),'Anh ạ. Anh nhé.'));
test('job data "Japan" is said "Nhật"',()=>{
 assert.match(approvedIntroReply({candidate_type:'BrSE',location:'Nhật'},jobs),/^Dạ ở Nhật bên em đang có vị trí BrSE,/);
});
