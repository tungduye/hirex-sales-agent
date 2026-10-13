export const HIREX_N8N_INSTANCES = {
  "hirex-1": {
    id: "hirex-1",
    label: "n8n HireX 1",
    origin: "https://absconditus-vulnero-territo-4xj76y.runopen.cloud",
  },
  "hirex-2": {
    id: "hirex-2",
    label: "n8n HireX 2",
    origin: "https://infit-amita-crudelis-6kk0r6.runopen.cloud",
  },
} as const;

export type N8nInstanceId = keyof typeof HIREX_N8N_INSTANCES;
export const DEFAULT_N8N_INSTANCE_ID: N8nInstanceId = "hirex-2";
export const HIREX_TRUSTED_N8N_ORIGIN = HIREX_N8N_INSTANCES[DEFAULT_N8N_INSTANCE_ID].origin;

export function parseN8nInstanceId(value: string | undefined): N8nInstanceId {
  return value && value in HIREX_N8N_INSTANCES ? value as N8nInstanceId : DEFAULT_N8N_INSTANCE_ID;
}

export function validateTrustedN8nOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return Object.values(HIREX_N8N_INSTANCES).some((instance) => instance.origin === url.origin) ? url.origin : null;
  } catch {
    return null;
  }
}
