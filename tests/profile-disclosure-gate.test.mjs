import test from 'node:test';
import assert from 'node:assert/strict';
import {missingIntroField,introductionQuestion} from '../src/modules/ai-recruiter/core/profile-disclosure-gate.ts';
const profile={candidate_type:'BrSE',location:'Hà Nội',japanese_level:'N2',japan_years:0};
test('zero Japan experience is a completed answer',()=>assert.equal(missingIntroField(profile),null));
test('each of four required fields blocks disclosure when missing',()=>{
 for(const field of Object.keys(profile)){assert.equal(missingIntroField({...profile,[field]:null}),field);assert.ok(introductionQuestion({...profile,[field]:null}));}
});
test('invalid years cannot pass the gate',()=>{
 for(const years of [undefined,NaN,-1,'chưa biết'])assert.equal(missingIntroField({...profile,japan_years:years}),'japan_years');
});
test('location already supplied is not asked again',()=>{
 assert.equal(missingIntroField({candidate_type:'BrSE',location:'Hà Nội'}),'japanese_level');
 assert.equal(introductionQuestion(profile),null);
});
