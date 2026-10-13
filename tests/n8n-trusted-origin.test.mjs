import assert from "node:assert/strict";
import test from "node:test";
import { HIREX_N8N_INSTANCES, HIREX_TRUSTED_N8N_ORIGIN, parseN8nInstanceId, validateTrustedN8nOrigin } from "../src/modules/integrations/n8n/core/trusted-origin.ts";

test("only the two selected n8n HTTPS origins are accepted", () => {
  assert.equal(validateTrustedN8nOrigin(HIREX_TRUSTED_N8N_ORIGIN), HIREX_TRUSTED_N8N_ORIGIN);
  assert.equal(validateTrustedN8nOrigin(`${HIREX_TRUSTED_N8N_ORIGIN}/`), HIREX_TRUSTED_N8N_ORIGIN);
  assert.equal(validateTrustedN8nOrigin(HIREX_N8N_INSTANCES["hirex-1"].origin), HIREX_N8N_INSTANCES["hirex-1"].origin);
  for (const value of [
    undefined,
    "http://infit-amita-crudelis-6kk0r6.runopen.cloud",
    "http://absconditus-vulnero-territo-4xj76y.runopen.cloud",
    `${HIREX_TRUSTED_N8N_ORIGIN}/api/v1`,
    `${HIREX_TRUSTED_N8N_ORIGIN}?next=https://evil.example`,
    `${HIREX_TRUSTED_N8N_ORIGIN}#fragment`,
    "https://user:password@infit-amita-crudelis-6kk0r6.runopen.cloud",
    "https://infit-amita-crudelis-6kk0r6.runopen.cloud.evil.example",
  ]) {
    assert.equal(validateTrustedN8nOrigin(value), null, String(value));
  }
});

test("unknown instance ids fall back to the established default", () => {
  assert.equal(parseN8nInstanceId("hirex-1"), "hirex-1");
  assert.equal(parseN8nInstanceId("hirex-2"), "hirex-2");
  assert.equal(parseN8nInstanceId("unknown"), "hirex-2");
});
