import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';

const source = readFileSync('src/app/api/internal/email-campaigns/process/route.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
async function run(legacyFailure, sequenceFailure) {
  const finalized = [];
  let sequenceCalls = 0;
  const base = { success: true, code: 'OK', campaignsConsidered: 1, recipientsProcessed: 0, deliveriesProcessed: 1, sent: 0, failed: 0, deliveryUnknown: 0 };
  const mocks = {
    activateDueEmailCampaigns: async () => 0,
    processEmailCampaignBatch: async () => ({ ...base, ...(legacyFailure ? { success: false, code: legacyFailure } : {}) }),
    processEmailCampaignSequenceBatch: async () => { sequenceCalls++; return { ...base, ...(sequenceFailure ? { success: false, code: sequenceFailure } : {}) }; },
    processPersistedCampaignReplies: async () => ({ repliedStopped: 0 }),
    processPersistedCampaignBounces: async () => ({ bouncedStopped: 0 }),
    getAutomationCronSecret: () => 'test', isValidAutomationBearer: () => true,
    startCampaignWorkerRun: async () => ({ id: 'test-run' }),
    finishCampaignWorkerRun: async (...args) => { finalized.push(args); return true; },
  };
  const context = { exports: {}, require: () => mocks, Response };
  vm.runInNewContext(compiled, context);
  const response = await context.exports.POST(new Request('http://localhost', { method: 'POST' }));
  return { response, body: await response.json(), finalized, sequenceCalls };
}
test('sequence finalization failure is HTTP 500 and FAILED heartbeat, not success', async () => {
  const r = await run(null, 'CAMPAIGN_FINALIZATION_UNAVAILABLE');
  assert.equal(r.response.status, 500);
  assert.equal(r.body.success, false);
  assert.equal(r.finalized[0][1], 'FAILED');
  assert.equal(r.finalized[0][3], 'CAMPAIGN_FINALIZATION_UNAVAILABLE');
  assert.equal(r.finalized[0][2].deliveries_processed, 1);
});
test('legacy failure stops before sequence work', async () => {
  const r = await run('DATABASE_UNAVAILABLE');
  assert.equal(r.response.status, 500);
  assert.equal(r.sequenceCalls, 0);
});
test('healthy run reports explicit success', async () => {
  const r = await run();
  assert.equal(r.response.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.finalized[0][1], 'SUCCEEDED');
});
