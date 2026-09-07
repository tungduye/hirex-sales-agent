#!/usr/bin/env node
import assert from "node:assert/strict";
import { isRemoteReadAuthorized, runRemoteReadBoundary } from "./phase4c-remote-read-guard.mjs";

let assertions = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); assertions += 1; };
for (const value of [undefined, "", "0", "true", "yes", " 1x "]) equal(isRemoteReadAuthorized({ HIREX_ALLOW_REMOTE_READ_TESTS: value }), false);
equal(isRemoteReadAuthorized({ HIREX_ALLOW_REMOTE_READ_TESTS: " 1 " }), true);

let defaultConnections = 0;
const local = await runRemoteReadBoundary({ environment: {}, connect: async () => { defaultConnections += 1; } });
equal(local.mode, "LOCAL"); equal(local.connected, false); equal(defaultConnections, 0);

let authorizedConnections = 0;
const remote = await runRemoteReadBoundary({ environment: { HIREX_ALLOW_REMOTE_READ_TESTS: "1" }, connect: async () => { authorizedConnections += 1; } });
equal(remote.mode, "REMOTE"); equal(remote.connected, true); equal(authorizedConnections, 1);
console.log(`PHASE4C_REMOTE_READ_GUARD_FIXTURES_PASS assertions=${assertions} defaultConnections=${defaultConnections}`);
