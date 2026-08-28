import assert from "node:assert/strict";
import { runSafeOperatorBootstrap } from "./gmail-reconciliation-inspector.mjs";
import { runReconciliationInspectorCli } from "../src/modules/integrations/gmail/domain/reconciliation-inspector-cli.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";

const candidate = {
  sendRequestId: requestId,
  workspaceId,
  emailAccountId: accountId,
  sendLockAt: "2026-08-28T01:00:00.000Z",
  attemptCount: 1,
};

async function execute(argv, {
  listError = null,
  inspectError = null,
  inspectResult = null,
} = {}) {
  const calls = { list: 0, inspect: 0, listInput: null, inspectInput: null };
  const output = await runReconciliationInspectorCli(argv, {
    list: async (input) => {
      calls.list += 1;
      calls.listInput = input;
      if (listError) throw listError;
      return { status: "READY", candidates: [candidate] };
    },
    inspect: async (input) => {
      calls.inspect += 1;
      calls.inspectInput = input;
      if (inspectError) throw inspectError;
      return inspectResult ?? {
        classification: "SAFE_MATCH",
        reason: "SAFE_EXACT_CANONICAL_MATCH",
        sendRequestId: requestId,
        matchedEmailMessageId: messageId,
      };
    },
  });
  return { output, calls };
}

const listArgs = ["list", "--workspace", workspaceId];
const inspectArgs = [
  "inspect", "--workspace", workspaceId,
  "--account", accountId, "--request", requestId,
];

const fixtures = [
  ["list valid workspace", async () => {
    const actual = await execute(listArgs);
    assert.equal(actual.output.status, "READY");
    assert.equal(actual.calls.listInput.workspaceId, workspaceId);
  }],
  ["list valid account filter", async () => {
    const actual = await execute([...listArgs, "--account", accountId]);
    assert.equal(actual.calls.listInput.emailAccountId, accountId);
  }],
  ["list default limit", async () => {
    const actual = await execute(listArgs);
    assert.equal(actual.calls.listInput.limit, 10);
  }],
  ["list limit above maximum clamps", async () => {
    const actual = await execute([...listArgs, "--limit", "100"]);
    assert.equal(actual.calls.listInput.limit, 25);
  }],
  ["zero limit rejected", async () => {
    const actual = await execute([...listArgs, "--limit", "0"]);
    assert.equal(actual.output.status, "INVALID_INPUT");
    assert.equal(actual.calls.list, 0);
  }],
  ["malformed workspace rejected", async () => {
    const actual = await execute(["list", "--workspace", "invalid"]);
    assert.equal(actual.output.status, "INVALID_INPUT");
    assert.equal(actual.calls.list, 0);
  }],
  ["inspect requires account", async () => {
    const actual = await execute([
      "inspect", "--workspace", workspaceId, "--request", requestId,
    ]);
    assert.equal(actual.output.status, "INVALID_INPUT");
  }],
  ["inspect requires request", async () => {
    const actual = await execute([
      "inspect", "--workspace", workspaceId, "--account", accountId,
    ]);
    assert.equal(actual.output.status, "INVALID_INPUT");
  }],
  ["malformed request rejected", async () => {
    const actual = await execute([
      "inspect", "--workspace", workspaceId,
      "--account", accountId, "--request", "invalid",
    ]);
    assert.equal(actual.output.status, "INVALID_INPUT");
    assert.equal(actual.calls.inspect, 0);
  }],
  ["malformed inspect account rejected", async () => {
    const actual = await execute([
      "inspect", "--workspace", workspaceId,
      "--account", "invalid", "--request", requestId,
    ]);
    assert.equal(actual.output.status, "INVALID_INPUT");
    assert.equal(actual.calls.inspect, 0);
  }],
  ["unknown command rejected", async () => {
    const actual = await execute(["execute", "--workspace", workspaceId]);
    assert.equal(actual.output.status, "INVALID_INPUT");
  }],
  ["unknown flag rejected", async () => {
    const actual = await execute([...listArgs, "--unsafe", "value"]);
    assert.equal(actual.output.status, "INVALID_INPUT");
  }],
  ["list calls discovery only", async () => {
    const actual = await execute(listArgs);
    assert.equal(actual.calls.list, 1);
    assert.equal(actual.calls.inspect, 0);
  }],
  ["inspect calls evaluator only", async () => {
    const actual = await execute(inspectArgs);
    assert.equal(actual.calls.inspect, 1);
    assert.equal(actual.calls.list, 0);
  }],
  ["NO_MATCH cannot use unavailable reason", async () => {
    const actual = await execute(inspectArgs, {
      inspectResult: {
        classification: "NO_MATCH",
        reason: "EVALUATION_UNAVAILABLE",
        sendRequestId: requestId,
        matchedEmailMessageId: null,
      },
    });
    assert.deepEqual(actual.output, {
      status: "UNAVAILABLE",
      code: "INSPECTOR_UNAVAILABLE",
    });
  }],
  ["NO_MATCH cannot use uncertain-body reason", async () => {
    const actual = await execute(inspectArgs, {
      inspectResult: {
        classification: "NO_MATCH",
        reason: "BODY_COMPARISON_UNCERTAIN",
        sendRequestId: requestId,
        matchedEmailMessageId: messageId,
      },
    });
    assert.deepEqual(actual.output, {
      status: "UNAVAILABLE",
      code: "INSPECTOR_UNAVAILABLE",
    });
  }],
  ["AMBIGUOUS cannot use no-match reason", async () => {
    const actual = await execute(inspectArgs, {
      inspectResult: {
        classification: "AMBIGUOUS",
        reason: "CORRELATION_NOT_FOUND",
        sendRequestId: requestId,
        matchedEmailMessageId: null,
      },
    });
    assert.equal(actual.output.status, "UNAVAILABLE");
  }],
  ["AMBIGUOUS cannot use safe-match reason", async () => {
    const actual = await execute(inspectArgs, {
      inspectResult: {
        classification: "AMBIGUOUS",
        reason: "SAFE_EXACT_CANONICAL_MATCH",
        sendRequestId: requestId,
        matchedEmailMessageId: messageId,
      },
    });
    assert.equal(actual.output.status, "UNAVAILABLE");
  }],
  ["AMBIGUOUS accepts uncertain-body reason", async () => {
    const actual = await execute(inspectArgs, {
      inspectResult: {
        classification: "AMBIGUOUS",
        reason: "BODY_COMPARISON_UNCERTAIN",
        sendRequestId: requestId,
        matchedEmailMessageId: messageId,
      },
    });
    assert.deepEqual(actual.output, {
      classification: "AMBIGUOUS",
      reason: "BODY_COMPARISON_UNCERTAIN",
      sendRequestId: requestId,
      matchedEmailMessageId: messageId,
    });
  }],
  ["valid SAFE_MATCH still passes", async () => {
    const actual = await execute(inspectArgs);
    assert.equal(actual.output.classification, "SAFE_MATCH");
    assert.equal(actual.output.matchedEmailMessageId, messageId);
  }],
  ["SAFE_MATCH without message ID fails closed", async () => {
    const actual = await execute(inspectArgs, {
      inspectResult: {
        classification: "SAFE_MATCH",
        reason: "SAFE_EXACT_CANONICAL_MATCH",
        sendRequestId: requestId,
        matchedEmailMessageId: null,
      },
    });
    assert.equal(actual.output.status, "UNAVAILABLE");
  }],
  ["mismatched evaluator request ID fails closed", async () => {
    const actual = await execute(inspectArgs, {
      inspectResult: {
        classification: "SAFE_MATCH",
        reason: "SAFE_EXACT_CANONICAL_MATCH",
        sendRequestId: "55555555-5555-4555-8555-555555555555",
        matchedEmailMessageId: messageId,
      },
    });
    assert.equal(actual.output.status, "UNAVAILABLE");
  }],
  ["list never calls evaluator", async () => {
    const actual = await execute(listArgs);
    assert.equal(actual.calls.inspect, 0);
  }],
  ["inspect never calls discovery", async () => {
    const actual = await execute(inspectArgs);
    assert.equal(actual.calls.list, 0);
  }],
  ["outputs only safe reviewed keys", async () => {
    const listed = await execute(listArgs);
    const inspected = await execute(inspectArgs);
    assert.deepEqual(Object.keys(listed.output.candidates[0]).sort(), [
      "attemptCount", "emailAccountId", "sendLockAt", "sendRequestId", "workspaceId",
    ]);
    assert.deepEqual(Object.keys(inspected.output).sort(), [
      "classification", "matchedEmailMessageId", "reason", "sendRequestId",
    ]);
  }],
  ["internal error maps to safe unavailable", async () => {
    const actual = await execute(listArgs, {
      listError: new Error("fixture internal details"),
    });
    assert.deepEqual(actual.output, {
      status: "UNAVAILABLE",
      code: "INSPECTOR_UNAVAILABLE",
    });
  }],
  ["unknown evaluator reason is not exposed", async () => {
    let inspectCalls = 0;
    const output = await runReconciliationInspectorCli(inspectArgs, {
      list: async () => ({ status: "READY", candidates: [] }),
      inspect: async () => {
        inspectCalls += 1;
        return {
          classification: "NO_MATCH",
          reason: "RAW_INTERNAL_REASON",
          sendRequestId: requestId,
          matchedEmailMessageId: null,
        };
      },
    });
    assert.deepEqual(output, {
      status: "UNAVAILABLE",
      code: "INSPECTOR_UNAVAILABLE",
    });
    assert.equal(inspectCalls, 1);
  }],
  ["dependency surface has no execution operation", async () => {
    const actual = await execute(inspectArgs);
    assert.deepEqual(actual.calls.inspectInput, {
      sendRequestId: requestId,
      workspaceId,
      emailAccountId: accountId,
    });
    assert.equal("execute" in actual.calls, false);
    assert.equal("reconcile" in actual.calls, false);
  }],
  ["bootstrap failure hides raw error details", async () => {
    const rawDetail = "DO_NOT_EXPOSE_BOOTSTRAP_SECRET";
    const output = await runSafeOperatorBootstrap(async () => {
      throw new Error(rawDetail);
    });
    assert.deepEqual(output, {
      status: "UNAVAILABLE",
      code: "INSPECTOR_UNAVAILABLE",
    });
    assert.equal(JSON.stringify(output).includes(rawDetail), false);
  }],
];

for (const [name, validate] of fixtures) {
  await assert.doesNotReject(validate, `${name}: unexpected failure`);
}

process.stdout.write(
  `gmail-reconciliation-inspector fixtures: ${fixtures.length} passed\n`,
);
