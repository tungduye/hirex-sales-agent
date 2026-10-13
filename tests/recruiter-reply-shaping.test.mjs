import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateBurst,shapeReply} from '../src/modules/ai-recruiter/core/reply-shaping.ts';
test('keeps location answer when followed by a job request',()=>{
 assert.equal(candidateBurst([{role:'OUTBOUND',text:'Ở đâu?'},{role:'INBOUND',text:'anh ưu tiên Hà Nội'},{role:'INBOUND',text:'em có job nào không'}]),'anh ưu tiên Hà Nội\nem có job nào không');
});
test('does not mix previous answered turns into the current burst',()=>{
 assert.equal(candidateBurst([{role:'INBOUND',text:'BrSE'},{role:'OUTBOUND',text:'Tiếng Nhật?'},{role:'INBOUND',text:'N2'}]),'N2');
});
test('stable variation produces one or two intact messages',()=>{
 const text='Em sẽ lọc các vị trí BrSE theo khu vực Hà Nội anh ưu tiên. Anh chia sẻ thêm kinh nghiệm làm cầu nối với khách Nhật để em đối chiếu yêu cầu nhé?';
 assert.equal(shapeReply([text],'b').length,1);
 assert.equal(shapeReply([text],'a').length,2);
 assert.equal(shapeReply([text],'a').join(' '),text);
 assert.deepEqual(shapeReply([text],'a'),shapeReply([text],'a'));
 assert.deepEqual(shapeReply(['Anh gửi giúp em CV nhé?'],'a'),['Anh gửi giúp em CV nhé?']);
});
