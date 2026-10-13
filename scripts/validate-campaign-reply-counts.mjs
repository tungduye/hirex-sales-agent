import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { countCampaignReplies } from '../src/modules/campaigns/domain/count-campaign-replies.ts';
const rows = Array.from({length:1244}, (_,i)=>({id:String(i).padStart(5,'0'),campaign_id:i===1243?'outside-first-1000':'other'}));
const counts = await countCampaignReplies(async after=>rows.filter(r=>after===null||r.id>after).slice(0,500));
assert.equal(counts.get('outside-first-1000'),1);
assert.equal(counts.get('other'),1243);
assert.equal((await countCampaignReplies(async()=>[])).size,0);
await assert.rejects(countCampaignReplies(async()=>{throw new Error('database unavailable')}));
console.log('PASS: paginated reply counts, empty results, database error propagation');
for (const file of ['run-initial-sync-batch.ts','run-incremental-sync-batch.ts','sync-latest-messages.ts']) {
  const source = await readFile(new URL('../src/modules/integrations/gmail/server/'+file,import.meta.url),'utf8');
  assert.match(source,/direction !== 'INBOUND'/,file+' must skip outgoing messages');
  assert.match(source,/labels.includes\('DRAFT'\)/,file+' must skip drafts');
}
console.log('PASS: inbound-only guards remain in all three sync paths');
