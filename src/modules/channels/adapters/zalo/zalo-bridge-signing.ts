import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function canonicalZaloBridgeSignatureInput(input:{method:string;path:string;timestamp:string;body:string;idempotencyKey:string}) {
  return [input.method.toUpperCase(),input.path,input.timestamp,createHash("sha256").update(input.body).digest("hex"),input.idempotencyKey].join("\n");
}
export function signZaloBridgeRequest(secret:string,input:{method:string;path:string;timestamp:string;body:string;idempotencyKey:string}) {
  return createHmac("sha256",secret).update(canonicalZaloBridgeSignatureInput(input)).digest("hex");
}
export function verifyZaloBridgeSignature(secret:string,input:{method:string;path:string;timestamp:string;body:string;idempotencyKey:string},signature:string) {
  const expected=Buffer.from(signZaloBridgeRequest(secret,input),"utf8"),actual=Buffer.from(signature,"utf8");
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
