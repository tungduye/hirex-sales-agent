export const MAX_CAMPAIGN_IMPORT_ROWS = 5_000;
export const MAX_RECIPIENTS_PER_WORKER_RUN = 25;
export const MAX_CAMPAIGN_BODY_LENGTH = 100_000;

const EMAIL = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const VARIABLE = /{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g;
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;

export type Personalization = Record<string, string>;

export function normalizeCampaignEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  const parts=email.split("@");const local=parts[0]??"";
  if (email.length < 3 || email.length > 254 || parts.length!==2 || local.length>64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") || CONTROLS.test(email) || !EMAIL.test(email)) return null;
  return email;
}

export function renderCampaignTemplate(template: string, values: Personalization) {
  const missing = new Set<string>();
  const rendered = template.replace(VARIABLE, (_match, key: string) => {
    const value = values[key];
    if (typeof value !== "string" || value.length === 0) {
      missing.add(key);
      return "";
    }
    return value;
  });
  return { rendered, missing: [...missing].sort() };
}

export function validateRenderedCampaignMessage(subject: string, body: string): string | null {
  if (!subject.trim() || subject.length > 998 || CONTROLS.test(subject)) return "INVALID_SUBJECT";
  if (!body.trim() || body.length > MAX_CAMPAIGN_BODY_LENGTH || body.includes("\0")) return "INVALID_BODY";
  return null;
}

export function parseCampaignCsv(source: string, maxRows = MAX_CAMPAIGN_IMPORT_ROWS): string[][] {
  if (source.length > 5_000_000) throw new Error("IMPORT_TOO_LARGE");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' && quoted && source[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      if (rows.length > maxRows + 1) throw new Error("IMPORT_ROW_LIMIT");
    } else field += char;
  }
  if (quoted) throw new Error("MALFORMED_CSV");
  row.push(field);
  if (row.some((value) => value.length > 0)) rows.push(row);
  if (rows.length > maxRows + 1) throw new Error("IMPORT_ROW_LIMIT");
  return rows;
}

export function isCampaignRunnable(status: string, scheduledAt: string | null, now: Date): boolean {
  return status === "RUNNING" || (status === "SCHEDULED" && Boolean(scheduledAt) && new Date(scheduledAt!).getTime() <= now.getTime());
}

const TRANSITIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  DRAFT:["SCHEDULED","RUNNING"],SCHEDULED:["RUNNING","CANCELLED"],RUNNING:["PAUSED","CANCELLED","COMPLETED"],PAUSED:["RUNNING","CANCELLED"],COMPLETED:[],CANCELLED:[],
});
export function canTransitionCampaign(from:string,to:string){return TRANSITIONS[from]?.includes(to)??false;}
export function mapCampaignSendResult(success:boolean,code:string):"SENT"|"FAILED"|"DELIVERY_UNKNOWN"{if(success&&code==="SENT")return "SENT";if(code==="DELIVERY_STATUS_UNKNOWN"||code==="SEND_IN_PROGRESS")return "DELIVERY_UNKNOWN";return "FAILED";}
export function buildCampaignPersonalization(input:{email:string;displayName:string|null;company:string|null;position:string|null;custom:Personalization}){const parts=(input.displayName??"").trim().split(/\s+/).filter(Boolean);return {...input.custom,email:input.email,name:input.displayName??"",company:input.company??"",position:input.position??"",first_name:input.custom.first_name||parts[0]||"",last_name:input.custom.last_name||parts.slice(1).join(" ")};}
