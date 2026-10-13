import test from 'node:test';
import assert from 'node:assert/strict';
import {brseLocationConsultation} from '../src/modules/ai-recruiter/core/recruiter-consultation.ts';
const profile={candidate_type:'BrSE',location:'Hà Nội'};
const jobs=[{candidate_type:'BrSE',location:'Hà Nội',requirements:'BrSE/PM, tiếng Nhật tốt, có khả năng trao đổi khách Nhật'}];
test('consults about actual communication instead of asking JLPT level',()=>{
 const parts=brseLocationConsultation(profile,'anh tìm job hn',jobs);
 assert.equal(parts.length,2);assert.match(parts[0],/Em có vị trí BrSE tại Hà Nội/);
 assert.match(parts[1],/sử dụng thường xuyên/);
 assert.doesNotMatch(parts.join(' '),/N mấy|mức nào|team phát triển/);
});
test('does not invent job or repeat Japanese qualification',()=>{
 assert.equal(brseLocationConsultation(profile,'job hn',[]),null);
 assert.equal(brseLocationConsultation({...profile,japanese_level:'N2'},'job hn',jobs),null);
 assert.equal(brseLocationConsultation(profile,'job hn',[{...jobs[0],location:'Hồ Chí Minh'}]),null);
 assert.equal(brseLocationConsultation(profile,'job hn',[{...jobs[0],requirements:''}]),null);
});
