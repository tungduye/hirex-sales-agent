import test from 'node:test';
import assert from 'node:assert/strict';
import { executeOutboundAction } from '../src/modules/channels/core/execute-outbound-action.ts';

// Migration 069: AI Recruiter AUTO actions carry approved_by = NULL. The executor must
// accept that only for AI_AUTOMATION and keep requiring a human approver elsewhere.
const ids = {
  action: '11111111-1111-4111-8111-111111111111',
  workspace: '22222222-2222-4222-8222-222222222222',
  policy: '33333333-3333-4333-8333-333333333333',
};

function action(overrides) {
  return {
    id: ids.action, workspaceId: ids.workspace, conversationId: null, providerConversationId: null,
    channelAccountId: '44444444-4444-4444-8444-444444444444', channelType: 'ZALO', recipientExternalId: 'candidate',
    status: 'APPROVED', textContent: 'Xin chào', attachmentIds: [], idempotencyKey: 'ai-recruiter:run:part:1',
    policyDecisionId: ids.policy, approvedBy: null, approvedAt: '2026-10-13T00:00:00.000Z', dispatchSource: 'AI_AUTOMATION',
    ...overrides,
  };
}

function dependencies(record) {
  const calls = { claim: 0 };
  return {
    calls,
    loadAction: async () => record,
    loadPolicy: async () => ({ id: ids.policy, workspaceId: ids.workspace, allowed: true, expiresAt: '2999-01-01T00:00:00.000Z' }),
    isSuppressed: async () => false,
    // Stop right after the eligibility gate: returning null makes the executor report NOT_ELIGIBLE
    // only after it has decided the action itself is eligible, which `calls.claim` records.
    claim: async () => { calls.claim += 1; return null; },
    loadClaimedAttachments: async () => [], validatePreSend: async () => ({ allowed: true, safeErrorCode: '' }),
    finalizeSent: async () => true, finalizeFailed: async () => true, finalizeUnknown: async () => true, deferConfirmedBusy: async () => false,
    adapters: { get() { throw new Error('unused'); } },
    createLockId: () => '55555555-5555-4555-8555-555555555555',
    now: () => '2026-10-13T00:00:00.000Z',
  };
}

test('AUTO action without a human approver passes the eligibility gate', async () => {
  const deps = dependencies(action({}));
  await executeOutboundAction(ids.action, deps);
  assert.equal(deps.calls.claim, 1);
});

for (const dispatchSource of ['HUMAN_MANUAL', 'CAMPAIGN', 'SYSTEM']) {
  test(`${dispatchSource} action without an approver is rejected before claim`, async () => {
    const deps = dependencies(action({ dispatchSource }));
    assert.deepEqual(await executeOutboundAction(ids.action, deps), { status: 'NOT_ELIGIBLE', actionId: ids.action });
    assert.equal(deps.calls.claim, 0);
  });
}

test('human-approved action still passes', async () => {
  const deps = dependencies(action({ dispatchSource: 'HUMAN_MANUAL', approvedBy: '66666666-6666-4666-8666-666666666666' }));
  await executeOutboundAction(ids.action, deps);
  assert.equal(deps.calls.claim, 1);
});

test('AUTO action still needs a valid approval time', async () => {
  const deps = dependencies(action({ approvedAt: 'not-a-date' }));
  assert.deepEqual(await executeOutboundAction(ids.action, deps), { status: 'NOT_ELIGIBLE', actionId: ids.action });
  assert.equal(deps.calls.claim, 0);
});
