import assert from "node:assert/strict";
import { executeManualSendReconciliation } from "../src/modules/integrations/gmail/domain/manual-send-reconciliation.ts";

const input = {
  sendRequestId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  emailAccountId: "33333333-3333-4333-8333-333333333333",
};
const messageId = "44444444-4444-4444-8444-444444444444";

function eligiblePreflight(overrides = {}) {
  return {
    id: input.sendRequestId,
    workspace_id: input.workspaceId,
    email_account_id: input.emailAccountId,
    send_lock_at: "2026-08-28T02:00:00.000Z",
    email_accounts: {
      id: input.emailAccountId,
      workspace_id: input.workspaceId,
      provider: "GMAIL",
      status: "CONNECTED",
    },
    ...overrides,
  };
}

function orchestration(status, reason, matchedEmailMessageId = null) {
  return {
    status,
    reason,
    sendRequestId: input.sendRequestId,
    matchedEmailMessageId,
  };
}

async function execute({
  manualInput = input,
  preflightResult = eligiblePreflight(),
  preflightError = null,
  reconciliationResult = orchestration("FINALIZED", "FINALIZED", messageId),
  reconciliationError = null,
} = {}) {
  const calls = {
    preflight: 0,
    reconcile: 0,
    preflightInput: null,
    reconcileInput: null,
  };
  const result = await executeManualSendReconciliation(manualInput, {
    preflight: async (exactInput) => {
      calls.preflight += 1;
      calls.preflightInput = exactInput;
      if (preflightError) throw preflightError;
      return preflightResult;
    },
    reconcile: async (exactInput) => {
      calls.reconcile += 1;
      calls.reconcileInput = exactInput;
      if (reconciliationError) throw reconciliationError;
      return reconciliationResult;
    },
  });
  return { result, calls };
}

const fixtures = [
  ["invalid request UUID", async () => {
    const actual = await execute({ manualInput: { ...input, sendRequestId: "invalid" } });
    assert.equal(actual.result.status, "INVALID_INPUT");
    assert.equal(actual.calls.preflight, 0);
    assert.equal(actual.calls.reconcile, 0);
  }],
  ["invalid workspace UUID", async () => {
    const actual = await execute({ manualInput: { ...input, workspaceId: "invalid" } });
    assert.equal(actual.result.status, "INVALID_INPUT");
    assert.equal(actual.calls.preflight, 0);
    assert.equal(actual.calls.reconcile, 0);
  }],
  ["invalid account UUID", async () => {
    const actual = await execute({ manualInput: { ...input, emailAccountId: "invalid" } });
    assert.equal(actual.result.status, "INVALID_INPUT");
    assert.equal(actual.calls.preflight, 0);
    assert.equal(actual.calls.reconcile, 0);
  }],
  ["eligible row absent", async () => {
    const actual = await execute({ preflightResult: null });
    assert.equal(actual.result.status, "NOT_ELIGIBLE");
    assert.equal(actual.calls.reconcile, 0);
  }],
  ["preflight database error", async () => {
    const actual = await execute({
      preflightError: new Error("fixture preflight failure"),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.calls.preflight, 1);
    assert.equal(actual.calls.reconcile, 0);
  }],
  ["malformed preflight", async () => {
    const actual = await execute({ preflightResult: { id: input.sendRequestId } });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.calls.reconcile, 0);
  }],
  ["cross-workspace preflight", async () => {
    const actual = await execute({
      preflightResult: eligiblePreflight({
        workspace_id: "55555555-5555-4555-8555-555555555555",
      }),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.calls.reconcile, 0);
  }],
  ["wrong-account preflight", async () => {
    const actual = await execute({
      preflightResult: eligiblePreflight({
        email_account_id: "55555555-5555-4555-8555-555555555555",
      }),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.calls.reconcile, 0);
  }],
  ["disconnected account evidence", async () => {
    const actual = await execute({
      preflightResult: eligiblePreflight({
        email_accounts: {
          id: input.emailAccountId,
          workspace_id: input.workspaceId,
          provider: "GMAIL",
          status: "DISCONNECTED",
        },
      }),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.calls.reconcile, 0);
  }],
  ["eligible exact row reconciles once", async () => {
    const actual = await execute();
    assert.equal(actual.calls.preflight, 1);
    assert.equal(actual.calls.reconcile, 1);
  }],
  ["exact IDs delegated", async () => {
    const actual = await execute();
    assert.deepEqual(actual.calls.reconcileInput, input);
  }],
  ["orchestrator FINALIZED", async () => {
    const actual = await execute();
    assert.equal(actual.result.status, "FINALIZED");
  }],
  ["FINALIZED without matched message fails closed", async () => {
    const actual = await execute({
      reconciliationResult: orchestration("FINALIZED", "FINALIZED"),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
  }],
  ["FINALIZED with unknown reason fails closed", async () => {
    const actual = await execute({
      reconciliationResult: orchestration("FINALIZED", "UNKNOWN_REASON", messageId),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
  }],
  ["FINALIZED with evaluator reason fails closed", async () => {
    const actual = await execute({
      reconciliationResult: orchestration(
        "FINALIZED",
        "CORRELATION_NOT_FOUND",
        messageId,
      ),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
  }],
  ["orchestrator NO_MATCH", async () => {
    const actual = await execute({
      reconciliationResult: orchestration("NO_MATCH", "CORRELATION_NOT_FOUND"),
    });
    assert.equal(actual.result.status, "NO_MATCH");
  }],
  ["orchestrator AMBIGUOUS", async () => {
    const actual = await execute({
      reconciliationResult: orchestration("AMBIGUOUS", "MULTIPLE_CORRELATION_MATCHES"),
    });
    assert.equal(actual.result.status, "AMBIGUOUS");
  }],
  ["orchestrator EVIDENCE_CHANGED", async () => {
    const actual = await execute({
      reconciliationResult: orchestration("EVIDENCE_CHANGED", "EVIDENCE_CHANGED", messageId),
    });
    assert.equal(actual.result.status, "EVIDENCE_CHANGED");
  }],
  ["EVIDENCE_CHANGED without matched message fails closed", async () => {
    const actual = await execute({
      reconciliationResult: orchestration(
        "EVIDENCE_CHANGED",
        "EVIDENCE_CHANGED",
      ),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
  }],
  ["NO_MATCH with unknown reason fails closed", async () => {
    const actual = await execute({
      reconciliationResult: orchestration("NO_MATCH", "UNKNOWN_REASON"),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
  }],
  ["mismatched orchestrator request ID fails closed", async () => {
    const actual = await execute({
      reconciliationResult: {
        ...orchestration("FINALIZED", "FINALIZED", messageId),
        sendRequestId: "55555555-5555-4555-8555-555555555555",
      },
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
  }],
  ["orchestrator INVALID_INPUT after valid manual input fails closed", async () => {
    const actual = await execute({
      reconciliationResult: orchestration("INVALID_INPUT", "INVALID_INPUT"),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
  }],
  ["orchestrator error is unavailable without retry", async () => {
    const actual = await execute({
      reconciliationError: new Error("fixture orchestration failure"),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.calls.reconcile, 1);
  }],
  ["orchestrator unavailable remains unavailable", async () => {
    const actual = await execute({
      reconciliationResult: orchestration(
        "UNAVAILABLE",
        "ORCHESTRATION_UNAVAILABLE",
      ),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.calls.reconcile, 1);
  }],
  ["caller matched message ID is ignored", async () => {
    const actual = await execute({
      manualInput: { ...input, matchedEmailMessageId: "66666666-6666-4666-8666-666666666666" },
    });
    assert.deepEqual(actual.calls.preflightInput, input);
    assert.deepEqual(actual.calls.reconcileInput, input);
    assert.equal("matchedEmailMessageId" in actual.calls.reconcileInput, false);
  }],
];

for (const [name, validate] of fixtures) {
  await assert.doesNotReject(validate, `${name}: unexpected failure`);
}

process.stdout.write(
  `gmail-manual-send-reconciliation fixtures: ${fixtures.length} passed\n`,
);
