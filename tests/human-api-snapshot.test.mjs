import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHumanSnapshot, HUMAN_DOCUMENT_FILTER, HUMAN_DOCUMENT_URL } from '../src/modules/human-documents/core/api-snapshot.ts';
const row = { docId: 1, docName: 'Report', groupDocument: 'Folder', status: '<p>Status</p>' };
test('maps Human API into existing snapshot shape', () => {
  assert.deepEqual(parseHumanSnapshot({code:200,type:'ok',data:[row]}), [{id:1,name:'Report',group:'Folder',status:'<p>Status</p>'}]);
});
test('rejects failed, empty, duplicate or malformed snapshots', () => {
  for (const value of [null, {code:401,type:'ok',data:[row]}, {code:200,type:'ok',data:[]},
    {code:200,type:'ok',data:[row,row]}, {code:200,type:'ok',data:[{...row,status:{}}]}]) assert.throws(()=>parseHumanSnapshot(value));
});
test('uses fixed approved destination and exact filter', () => {
  assert.equal(HUMAN_DOCUMENT_URL,'http://52.220.196.215:8088/document/all');
  assert.deepEqual(HUMAN_DOCUMENT_FILTER.sort,['docId,desc']);
  assert.equal(Object.values(HUMAN_DOCUMENT_FILTER).filter(x=>x===null).length,8);
});
