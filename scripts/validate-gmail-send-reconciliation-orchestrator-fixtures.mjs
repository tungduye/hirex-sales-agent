import assert from "node:assert/strict";
import { orchestrateAmbiguousSendReconciliation } from "../src/modules/integrations/gmail/domain/orchestrate-ambiguous-send.ts";

const input = {
  sendRequestId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  emailAccountId: "33333333-3333-4333-8333-333333333333",
};
const messageId = "44444444-4444-4444-8444-444444444444";

function evaluation(classification, reason, matchedEmailMessageId = null) {
  return {
    classification,
    reason,
    sendRequestId: input.sendRequestId,
    matchedEmailMessageId,
  };
}

async function execute({
  orchestrationInput = input,
  evaluatorResult = evaluation("SAFE_MATCH", "SAFE_EXACT_CANONICAL_MATCH", messageId),
  evaluatorError = null,
  finalizerResult = true,
  finalizerError = null,
} = {}) {
  const calls = { evaluate: 0, finalize: 0, finalizedWith: null };
  const result = await orchestrateAmbiguousSendReconciliation(
    orchestrationInput,
    {
      evaluate: async () => {
        calls.evaluate += 1;
        if (evaluatorError) throw evaluatorError;
        return evaluatorResult;
      },
      finalize: async (finalizeInput) => {
        calls.finalize += 1;
        calls.finalizedWith = finalizeInput;
        if (finalizerError) throw finalizerError;
        return finalizerResult;
      },
    },
  );
  return { result, calls };
}

const fixtures = [
  ["invalid UUID", async () => {
    const actual = await execute({
      orchestrationInput: { ...input, workspaceId: "not-a-uuid" },
    });
    assert.equal(actual.result.status, "INVALID_INPUT");
    assert.equal(actual.calls.evaluate, 0);
    assert.equal(actual.calls.finalize, 0);
  }],
  ["NO_MATCH never finalizes", async () => {
    const actual = await execute({
      evaluatorResult: evaluation("NO_MATCH", "CORRELATION_NOT_FOUND"),
    });
    assert.equal(actual.result.status, "NO_MATCH");
    assert.equal(actual.calls.finalize, 0);
  }],
  ["AMBIGUOUS never finalizes", async () => {
    const actual = await execute({
      evaluatorResult: evaluation("AMBIGUOUS", "MULTIPLE_CORRELATION_MATCHES"),
    });
    assert.equal(actual.result.status, "AMBIGUOUS");
    assert.equal(actual.calls.finalize, 0);
  }],
  ["SAFE_MATCH missing message UUID fails closed", async () => {
    const actual = await execute({
      evaluatorResult: evaluation("SAFE_MATCH", "SAFE_EXACT_CANONICAL_MATCH"),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.result.reason, "MATCHED_MESSAGE_INVALID");
    assert.equal(actual.calls.finalize, 0);
  }],
  ["SAFE_MATCH invalid message UUID fails closed", async () => {
    const actual = await execute({
      evaluatorResult: evaluation("SAFE_MATCH", "SAFE_EXACT_CANONICAL_MATCH", "invalid"),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.calls.finalize, 0);
  }],
  ["SAFE_MATCH with ineligible reason fails closed", async () => {
    const actual = await execute({
      evaluatorResult: evaluation("SAFE_MATCH", "REQUEST_NOT_ELIGIBLE", messageId),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.calls.finalize, 0);
  }],
  ["unknown evaluator reason fails closed", async () => {
    const actual = await execute({
      evaluatorResult: evaluation("NO_MATCH", "UNKNOWN_EVALUATOR_REASON"),
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.calls.finalize, 0);
  }],
  ["mismatched evaluator request ID fails closed", async () => {
    const actual = await execute({
      evaluatorResult: {
        ...evaluation("SAFE_MATCH", "SAFE_EXACT_CANONICAL_MATCH", messageId),
        sendRequestId: "55555555-5555-4555-8555-555555555555",
      },
    });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.calls.finalize, 0);
  }],
  ["SAFE_MATCH and RPC true finalizes", async () => {
    const actual = await execute();
    assert.equal(actual.result.status, "FINALIZED");
    assert.equal(actual.calls.finalize, 1);
  }],
  ["SAFE_MATCH and RPC false reports changed evidence", async () => {
    const actual = await execute({ finalizerResult: false });
    assert.equal(actual.result.status, "EVIDENCE_CHANGED");
    assert.equal(actual.calls.finalize, 1);
  }],
  ["evaluator unavailable", async () => {
    const actual = await execute({ evaluatorError: new Error("fixture evaluator error") });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.calls.finalize, 0);
  }],
  ["RPC error is unavailable without retry", async () => {
    const actual = await execute({ finalizerError: new Error("fixture RPC error") });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.equal(actual.calls.finalize, 1);
  }],
  ["malformed truthy finalizer result never finalizes", async () => {
    const actual = await execute({ finalizerResult: "true" });
    assert.equal(actual.result.status, "UNAVAILABLE");
    assert.notEqual(actual.result.status, "FINALIZED");
    assert.equal(actual.calls.finalize, 1);
  }],
  ["exact scoped IDs passed once", async () => {
    const actual = await execute();
    assert.equal(actual.calls.finalize, 1);
    assert.deepEqual(actual.calls.finalizedWith, {
      ...input,
      emailMessageId: messageId,
    });
  }],
];

for (const [name, validate] of fixtures) {
  await assert.doesNotReject(validate, `${name}: unexpected failure`);
}

process.stdout.write(
  `gmail-send-reconciliation orchestrator fixtures: ${fixtures.length} passed\n`,
);
