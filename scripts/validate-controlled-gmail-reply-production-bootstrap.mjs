import assert from "node:assert/strict";
import {
  loadControlledReplyLiveTestProductionDependencies,
  runSafeControlledReplyLiveTestBootstrap,
} from "./run-controlled-gmail-reply-live-test.mjs";

let count = 0;
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); count += 1; }

const dependencies = await loadControlledReplyLiveTestProductionDependencies();
for (const name of ["runControlledReplyLiveTestCli", "mapEvaluation", "evaluateReplyTarget",
  "createReplySendRequest", "inspectReplySendRequest", "sendOneReplyMessage"]) {
  check(`${name} resolves as function`, typeof dependencies[name], "function");
}

const liveCalls = { preflight: 0, creation: 0, inspection: 0, executor: 0 };
const unavailable = await runSafeControlledReplyLiveTestBootstrap(async () => {
  throw new Error("raw module import failure");
});
check("bootstrap failure status", unavailable.status, "UNAVAILABLE");
check("bootstrap failure reason", unavailable.reason, "LIVE_TEST_BOOTSTRAP_UNAVAILABLE");
check("bootstrap failure stage", unavailable.failureStage, "BOOTSTRAP");
check("bootstrap failure executor status null", unavailable.executorStatus, null);
check("bootstrap failure executor reason null", unavailable.executorReason, null);
check("bootstrap failure invokes no live dependency", liveCalls,
  { preflight: 0, creation: 0, inspection: 0, executor: 0 });
for (const forbidden of ["accessToken", "refreshToken", "sendLockId", "raw", "stack", "error"]) {
  check(`bootstrap output excludes ${forbidden}`, Object.hasOwn(unavailable, forbidden), false);
}

process.stdout.write(`controlled-gmail-reply-production-bootstrap fixtures: ${count} passed\n`);
