import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getGmailServerConfig } from "@/modules/integrations/gmail/server/config";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;

export function encryptCredential(value: string) {
  const { encryptionKey } = getGmailServerConfig();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptCredential(value: string) {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext, extra] = value.split(":");
  if (version !== VERSION || !encodedIv || !encodedAuthTag || !encodedCiphertext || extra) {
    throw new Error("Unsupported encrypted credential format.");
  }

  const { encryptionKey } = getGmailServerConfig();
  const iv = Buffer.from(encodedIv, "base64");
  const authTag = Buffer.from(encodedAuthTag, "base64");
  const ciphertext = Buffer.from(encodedCiphertext, "base64");
  const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
