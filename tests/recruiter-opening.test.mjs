import test from 'node:test';
import assert from 'node:assert/strict';
import {initialRecruiterOpening,recruiterOpening} from '../src/modules/ai-recruiter/core/recruiter-opening.ts';
const inbound=text=>({role:'INBOUND',text});
test('first greeting uses the exact approved opening',()=>assert.equal(initialRecruiterOpening([inbound('hi em')],{}),recruiterOpening));
test('repeated greetings before a reply still use opening',()=>assert.equal(initialRecruiterOpening([inbound('hi em'),inbound('hi em')],{}),recruiterOpening));
test('does not restart opening after bot has replied',()=>assert.equal(initialRecruiterOpening([{role:'OUTBOUND',text:recruiterOpening},inbound('hi em')],{}),null));
test('does not ignore a supplied role or substantive request',()=>{
 assert.equal(initialRecruiterOpening([inbound('hi em')],{candidate_type:'BrSE'}),null);
 assert.equal(initialRecruiterOpening([inbound('Anh muốn làm BrSE tại Hà Nội')],{}),null);
});
