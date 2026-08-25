import "server-only";

interface GmailServerConfig {
  googleClientId: string;
  googleClientSecret: string;
  redirectUri: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  encryptionKey: Buffer;
}

let cachedConfig: GmailServerConfig | null = null;

export function getGmailServerConfig(): GmailServerConfig {
  if (cachedConfig) return cachedConfig;

  const googleClientId = requireEnvironmentVariable("GOOGLE_CLIENT_ID");
  const googleClientSecret = requireEnvironmentVariable("GOOGLE_CLIENT_SECRET");
  const redirectUri = requireValidUrl("GMAIL_OAUTH_REDIRECT_URI");
  const supabaseUrl = requireValidUrl("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseSecretKey = requireEnvironmentVariable("SUPABASE_SECRET_KEY");
  const encryptionKey = decodeEncryptionKey();

  cachedConfig = {
    googleClientId,
    googleClientSecret,
    redirectUri,
    supabaseUrl,
    supabaseSecretKey,
    encryptionKey,
  };

  return cachedConfig;
}

function requireEnvironmentVariable(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

function requireValidUrl(name: string) {
  const value = requireEnvironmentVariable(name);

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new Error(`Invalid server configuration: ${name}`);
  }
}

function decodeEncryptionKey() {
  const encodedKey = requireEnvironmentVariable("EMAIL_TOKEN_ENCRYPTION_KEY");
  const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

  if (!base64Pattern.test(encodedKey)) {
    throw new Error("Invalid server configuration: EMAIL_TOKEN_ENCRYPTION_KEY");
  }

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("Invalid server configuration: EMAIL_TOKEN_ENCRYPTION_KEY");
  }

  return key;
}
