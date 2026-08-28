import assert from "node:assert/strict";
import {
  DEFAULT_SEND_RECONCILIATION_CANDIDATE_LIMIT,
  MAX_SEND_RECONCILIATION_CANDIDATE_LIMIT,
  discoverSendReconciliationCandidates,
} from "../src/modules/integrations/gmail/domain/discover-send-reconciliation-candidates.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const emailAccountId = "22222222-2222-4222-8222-222222222222";
const firstId = "33333333-3333-4333-8333-333333333333";
const secondId = "44444444-4444-4444-8444-444444444444";

function row(overrides = {}) {
  return {
    id: firstId,
    workspace_id: workspaceId,
    email_account_id: emailAccountId,
    send_lock_at: "2026-08-28T01:00:00.000Z",
    attempt_count: 1,
    send_lock_id: "55555555-5555-4555-8555-555555555555",
    email_accounts: {
      id: emailAccountId,
      workspace_id: workspaceId,
      provider: "GMAIL",
      status: "CONNECTED",
    },
    ...overrides,
  };
}

async function execute(input = { workspaceId }, rows = [row()], readError = null) {
  let readCount = 0;
  let normalizedInput = null;
  const result = await discoverSendReconciliationCandidates(input, {
    read: async (normalized) => {
      readCount += 1;
      normalizedInput = normalized;
      if (readError) throw readError;
      return rows;
    },
  });
  return { result, readCount, normalizedInput };
}

const fixtures = [
  ["invalid workspace UUID", async () => {
    const actual = await execute({ workspaceId: "invalid" });
    assert.equal(actual.result.status, "INVALID_INPUT");
    assert.equal(actual.result.candidates.length, 0);
    assert.equal(actual.readCount, 0);
  }],
  ["invalid optional account UUID", async () => {
    const actual = await execute({ workspaceId, emailAccountId: "invalid" });
    assert.equal(actual.result.status, "INVALID_INPUT");
    assert.equal(actual.readCount, 0);
  }],
  ["zero limit", async () => {
    const actual = await execute({ workspaceId, limit: 0 });
    assert.equal(actual.result.status, "INVALID_INPUT");
    assert.equal(actual.readCount, 0);
  }],
  ["negative limit", async () => {
    const actual = await execute({ workspaceId, limit: -1 });
    assert.equal(actual.result.status, "INVALID_INPUT");
    assert.equal(actual.readCount, 0);
  }],
  ["non-integer limit", async () => {
    const actual = await execute({ workspaceId, limit: 1.5 });
    assert.equal(actual.result.status, "INVALID_INPUT");
    assert.equal(actual.readCount, 0);
  }],
  ["limit above maximum is clamped", async () => {
    const actual = await execute({ workspaceId, limit: 100 });
    assert.equal(actual.result.status, "READY");
    assert.equal(actual.normalizedInput.limit, MAX_SEND_RECONCILIATION_CANDIDATE_LIMIT);
  }],
  ["default limit", async () => {
    const actual = await execute();
    assert.equal(actual.result.status, "READY");
    assert.equal(actual.normalizedInput.limit, DEFAULT_SEND_RECONCILIATION_CANDIDATE_LIMIT);
  }],
  ["explicit account filter", async () => {
    const actual = await execute({ workspaceId, emailAccountId, limit: 5 });
    assert.equal(actual.result.status, "READY");
    assert.equal(actual.normalizedInput.emailAccountId, emailAccountId);
    assert.equal(actual.normalizedInput.limit, 5);
  }],
  ["database failure", async () => {
    const actual = await execute(
      { workspaceId },
      [],
      new Error("fixture database failure"),
    );
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.result.candidates.length, 0);
  }],
  ["output excludes lock UUID and sensitive fields", async () => {
    const actual = await execute();
    assert.deepEqual(Object.keys(actual.result.candidates[0]).sort(), [
      "attemptCount",
      "emailAccountId",
      "sendLockAt",
      "sendRequestId",
      "workspaceId",
    ]);
    assert.equal("send_lock_id" in actual.result.candidates[0], false);
  }],
  ["oldest lock then request ID ordering", async () => {
    const actual = await execute(
      { workspaceId },
      [
        row({ id: secondId, send_lock_at: "2026-08-28T02:00:00.000Z" }),
        row({ id: secondId, send_lock_at: "2026-08-28T01:00:00.000Z" }),
        row({ id: firstId, send_lock_at: "2026-08-28T01:00:00.000Z" }),
      ],
    );
    assert.deepEqual(
      actual.result.candidates.map((candidate) => candidate.sendRequestId),
      [firstId, secondId, secondId],
    );
  }],
  ["outside-workspace candidate fails closed", async () => {
    const otherWorkspace = "66666666-6666-4666-8666-666666666666";
    const actual = await execute(
      { workspaceId },
      [row({ workspace_id: otherWorkspace })],
    );
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.result.candidates.length, 0);
  }],
];

for (const [name, validate] of fixtures) {
  await assert.doesNotReject(validate, `${name}: unexpected failure`);
}

process.stdout.write(
  `gmail-send-reconciliation discovery fixtures: ${fixtures.length} passed\n`,
);
