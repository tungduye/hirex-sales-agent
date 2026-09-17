import "server-only";

export const TRUSTED_ZALO_BRIDGE_ORIGIN = "https://zalo-bridge.hirexmkt.online";

/** Database configuration is metadata, never authority for a signed request. */
export function requireTrustedZaloBridgeOrigin(value: unknown): string {
  if (typeof value !== "string" || !/^https:\/\/zalo-bridge\.hirexmkt\.online\/?$/iu.test(value)) {
    throw new Error("ZALO_BRIDGE_DESTINATION_UNTRUSTED");
  }
  const parsed = new URL(value);
  if (parsed.origin !== TRUSTED_ZALO_BRIDGE_ORIGIN || parsed.username || parsed.password || parsed.port ||
      parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new Error("ZALO_BRIDGE_DESTINATION_UNTRUSTED");
  }
  return TRUSTED_ZALO_BRIDGE_ORIGIN;
}
