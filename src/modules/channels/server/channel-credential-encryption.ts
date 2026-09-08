import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey() {
  const raw = process.env.CHANNEL_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("CHANNEL_CREDENTIAL_KEY_MISSING");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CHANNEL_CREDENTIAL_KEY_INVALID");
  return key;
}

export function decryptChannelCredential(value: string) {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext, extra] = value.split(":");
  if (version !== "v1" || !encodedIv || !encodedAuthTag || !encodedCiphertext || extra) throw new Error("CHANNEL_CREDENTIAL_FORMAT_INVALID");
  const iv=Buffer.from(encodedIv,"base64"), authTag=Buffer.from(encodedAuthTag,"base64"), ciphertext=Buffer.from(encodedCiphertext,"base64");
  if(iv.length!==12||authTag.length!==16||ciphertext.length===0)throw new Error("CHANNEL_CREDENTIAL_FORMAT_INVALID");
  const decipher=createDecipheriv("aes-256-gcm",encryptionKey(),iv); decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString("utf8");
}

export function encryptChannelCredential(value: string) {
  if (!value) throw new Error("CHANNEL_CREDENTIAL_VALUE_INVALID");
  const iv=randomBytes(12), cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);
  const ciphertext=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return ["v1",iv.toString("base64"),cipher.getAuthTag().toString("base64"),ciphertext.toString("base64")].join(":");
}
