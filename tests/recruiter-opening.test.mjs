import test from 'node:test';
import assert from 'node:assert/strict';
import {initialRecruiterOpening,recruiterOpening,recruiterGreeting,withFirstGreeting} from '../src/modules/ai-recruiter/core/recruiter-opening.ts';
const inbound=text=>({role:'INBOUND',text});
test('first greeting uses the exact approved opening',()=>assert.equal(initialRecruiterOpening([inbound('hi em')],{}),recruiterOpening));
test('repeated greetings before a reply still use opening',()=>assert.equal(initialRecruiterOpening([inbound('hi em'),inbound('hi em')],{}),recruiterOpening));
test('does not restart opening after bot has replied',()=>assert.equal(initialRecruiterOpening([{role:'OUTBOUND',text:recruiterOpening},inbound('hi em')],{}),null));
test('does not ignore a supplied role or substantive request',()=>{
 assert.equal(initialRecruiterOpening([inbound('hi em')],{candidate_type:'BrSE'}),null);
 assert.equal(initialRecruiterOpening([inbound('Anh muốn làm BrSE tại Hà Nội')],{}),null);
});
test('other common greetings also get the opening',()=>{
 for(const text of ['helo em','Hello em ạ','alo','xin chào','hi ad','e ơi'])assert.equal(initialRecruiterOpening([inbound(text)],{}),recruiterOpening,text);
 assert.equal(initialRecruiterOpening([inbound('helo em, anh tìm job BrSE')],{}),null);
});
test('the first reply always greets, later replies do not',()=>{
 const reply=['Em có vị trí BrSE tại Hà Nội. Hiện anh sử dụng tiếng Nhật trong công việc thế nào ạ.'];
 assert.deepEqual(withFirstGreeting(reply,[inbound('anh tìm job brse ở HN')]),[`${recruiterGreeting}\n\n${reply[0]}`]);
 assert.deepEqual(withFirstGreeting([recruiterOpening],[inbound('hi em')]),[recruiterOpening],'opening already greets');
 assert.deepEqual(withFirstGreeting(reply,[inbound('hi'),{role:'OUTBOUND',text:recruiterOpening},inbound('brse')]),reply);
});
