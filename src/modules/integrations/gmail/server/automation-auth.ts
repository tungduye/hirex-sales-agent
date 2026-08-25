import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

export function getAutomationCronSecret() {
  const secret = process.env.AUTOMATION_CRON_SECRET?.trim();
  if (!secret) throw new Error("Missing required server configuration: AUTOMATION_CRON_SECRET");
  return secret;
}

export function isValidAutomationBearer(authorization: string | null, expectedSecret: string) {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  if (!supplied) return false;
  const suppliedDigest = createHash("sha256").update(supplied, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expectedSecret, "utf8").digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}
