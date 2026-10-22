import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverIntroMemory} from '../src/modules/ai-recruiter/core/intro-memory.ts';
import {missingIntroField} from '../src/modules/ai-recruiter/core/profile-disclosure-gate.ts';
test('BrSE then Hanoi does not restart role collection',()=>{
 const profile=recoverIntroMemory([{role:'INBOUND',text:'hi em'},{role:'INBOUND',text:'brse em'},{role:'OUTBOUND',text:'Hà Nội hay HCM?'},{role:'INBOUND',text:'hà nội'}],{location:'Hà Nội'});
 assert.equal(profile.candidate_type,'BrSE');assert.equal(missingIntroField(profile),'japanese_level');
});
test('does not learn bot suggestions or ambiguous/negative statements',()=>{
 assert.deepEqual(recoverIntroMemory([{role:'OUTBOUND',text:'BrSE'},{role:'INBOUND',text:'không muốn brse'},{role:'INBOUND',text:'PM hoặc dev'}],{}),{});
});
test('preserves verified corrections and zero',()=>{
 assert.deepEqual(recoverIntroMemory([{role:'INBOUND',text:'brse em'}],{candidate_type:'PM',japan_years:0}),{candidate_type:'PM',japan_years:0});
});
test('several places in one answer to "khu vực nào": first is the location, all are preferences',()=>{
 const profile=recoverIntroMemory([{role:'INBOUND',text:'anh quan tâm brse'},{role:'OUTBOUND',text:'BrSE cũng là hướng bên em đang tuyển anh ạ. Hiện có các vị trí ở HCM, Nhật và Hà Nội. Đợt này anh muốn tìm cơ hội ở khu vực nào ạ.'},{role:'INBOUND',text:'Anh tìm ở HN và Nhật cũng ok'}],{});
 assert.equal(profile.candidate_type,'BrSE');assert.equal(profile.location,'Hà Nội');assert.deepEqual(profile.preferred_locations,['Hà Nội','Nhật']);
 assert.equal(missingIntroField(profile),'japanese_level');
});
test('places are not learnt from a negative answer or without the question',()=>{
 assert.equal(recoverIntroMemory([{role:'OUTBOUND',text:'Anh muốn làm ở khu vực nào ạ.'},{role:'INBOUND',text:'không ở HCM đâu'}],{}).location,undefined);
 assert.equal(recoverIntroMemory([{role:'INBOUND',text:'tiếng nhật anh N2, ở HN'}],{}).location,undefined);
});
