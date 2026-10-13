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
