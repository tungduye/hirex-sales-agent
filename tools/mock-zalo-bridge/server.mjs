#!/usr/bin/env node
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const HOST = "127.0.0.1";
const PORT = Number(process.env.MOCK_ZALO_BRIDGE_PORT ?? "8787");
const ACCOUNT_ID = process.env.MOCK_ZALO_ACCOUNT_ID ?? "mock-zalo-account-001";
const SIGNING_SECRET = process.env.MOCK_ZALO_SIGNING_SECRET;
const MAX_SKEW_SECONDS = 300;

if (!SIGNING_SECRET || SIGNING_SECRET.length < 32) {
  console.error("MOCK_ZALO_CONFIG_INVALID");
  process.exit(1);
}

const state = {
  health: "HEALTHY",
  healthMode: "NORMAL",
  sendMode: "SENT",
  healthCalls: 0,
  sendCalls: 0,
  deliveries: new Map(),
};

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function safeEqual(left, right) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function expectedSignature(method, path, timestamp, body, idempotencyKey) {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = `${method}\n${path}\n${timestamp}\n${bodyHash}\n${idempotencyKey}`;
  return createHmac("sha256", SIGNING_SECRET).update(canonical).digest("hex");
}

function verifyRequest(request, path, body) {
  const timestamp = request.headers["x-hirex-timestamp"];
  const signature = request.headers["x-hirex-signature"];
  const idempotencyKey = request.headers["x-hirex-idempotency-key"] ?? "";
  const timestampNumber = Number(timestamp);
  if (typeof timestamp !== "string" || typeof signature !== "string" || typeof idempotencyKey !== "string") return false;
  if (!Number.isSafeInteger(timestampNumber) || Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > MAX_SKEW_SECONDS) return false;
  return safeEqual(signature, expectedSignature(request.method, path, timestamp, body, idempotencyKey));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
    const path = url.pathname;
    const body = await readBody(request);

    if (request.method === "POST" && path === "/__mock/state") {
      const controlSecret = request.headers["x-mock-control-secret"];
      if (!safeEqual(String(controlSecret ?? ""), SIGNING_SECRET)) return json(response, 403, { error: "FORBIDDEN" });
      const next = JSON.parse(body);
      if (next.health !== undefined) state.health = next.health;
      if (next.healthMode !== undefined) state.healthMode = next.healthMode;
      if (next.sendMode !== undefined) state.sendMode = next.sendMode;
      if (next.reset === true) {
        state.healthCalls = 0;
        state.sendCalls = 0;
        state.deliveries.clear();
      }
      return json(response, 200, { updated: true });
    }

    if (request.method === "GET" && path === "/__mock/metrics") {
      const controlSecret = request.headers["x-mock-control-secret"];
      if (!safeEqual(String(controlSecret ?? ""), SIGNING_SECRET)) return json(response, 403, { error: "FORBIDDEN" });
      return json(response, 200, { healthCalls: state.healthCalls, sendCalls: state.sendCalls, deliveries: state.deliveries.size });
    }

    if (!verifyRequest(request, path, body)) return json(response, 401, { error: "INVALID_SIGNATURE" });

    if (request.method === "GET" && path === `/v1/accounts/${encodeURIComponent(ACCOUNT_ID)}/health`) {
      state.healthCalls += 1;
      if (state.healthMode === "HTTP_ERROR") return json(response, 503, { error: "TEMPORARY" });
      if (state.healthMode === "MALFORMED") return json(response, 200, { unexpected: true });
      if (state.healthMode === "TIMEOUT") return;
      return json(response, 200, { status: state.health });
    }

    if (request.method === "POST" && path === "/v1/messages/send") {
      state.sendCalls += 1;
      const idempotencyKey = String(request.headers["x-hirex-idempotency-key"] ?? "");
      if (!idempotencyKey) return json(response, 400, { status: "FAILED" });
      const existing = state.deliveries.get(idempotencyKey);
      if (existing) return json(response, 200, existing);
      if (state.sendMode === "FAILED") return json(response, 200, { status: "FAILED" });
      if (state.sendMode === "UNKNOWN") return json(response, 200, { status: "UNKNOWN" });
      if (state.sendMode === "MALFORMED") return json(response, 200, { status: "SENT" });
      if (state.sendMode === "TIMEOUT_AFTER_ACCEPT") {
        state.deliveries.set(idempotencyKey, { status: "SENT", messageId: `mock-${idempotencyKey}`, threadId: "mock-zalo-thread-001" });
        return;
      }
      const result = { status: "SENT", messageId: `mock-${idempotencyKey}`, threadId: "mock-zalo-thread-001" };
      state.deliveries.set(idempotencyKey, result);
      return json(response, 200, result);
    }

    return json(response, 404, { error: "NOT_FOUND" });
  } catch {
    return json(response, 400, { error: "INVALID_REQUEST" });
  }
});

server.listen(PORT, HOST, () => console.log(`MOCK_ZALO_BRIDGE_READY port=${PORT}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
