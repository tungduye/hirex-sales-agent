import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,n){return n(s==='./campaign-rules'&&c.parentURL?.endsWith('/audience-import.ts')?s+'.ts':s,c);}});
const {prepareAudience}=await import('../src/modules/campaigns/domain/audience-import.ts');
test('Vietnamese name and normalized deduplication',()=>{const p=prepareAudience([['Tên ứng viên','Email'],['A',' A@EXAMPLE.COM '],['B','a@example.com'],['C','wrong']]);assert.equal(p.recipients[0].display_name,'A');assert.equal(p.recipients[0].email,'a@example.com');assert.equal(p.duplicateRows,1);assert.equal(p.invalidEmailRows,1);});
test('large list accepted and upper bound enforced',()=>{const rows=[['name','email'],...Array.from({length:20000},(_,i)=>['A',`a${i}@example.com`])];assert.equal(prepareAudience(rows).recipients.length,20000);assert.throws(()=>prepareAudience([...rows,['B','b@example.com']]),/ROW_LIMIT/);});
test('bad headers rejected',()=>{assert.throws(()=>prepareAudience([['Name'],['A']]),/MISSING_EMAIL/);assert.throws(()=>prepareAudience([['Email','e-mail'],['a@b.com','b@c.com']]),/DUPLICATE_HEADERS/);});
