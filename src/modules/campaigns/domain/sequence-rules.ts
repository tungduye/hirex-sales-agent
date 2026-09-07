export const MAX_SEQUENCE_STEPS = 6;
export const MAX_FOLLOW_UPS = 5;

export type CampaignEngagement = "ACTIVE" | "REPLIED" | "HARD_BOUNCED" | "UNSUBSCRIBED" | "COMPLETED" | "CANCELLED";

export interface SequenceStepInput {
  stepOrder: number;
  stepType: "INITIAL" | "FOLLOW_UP";
  delayMinutes: number;
  subjectTemplate: string;
  bodyTextTemplate: string;
  enabled: boolean;
}

export function validateSequence(steps: SequenceStepInput[]): string | null {
  const enabled = steps.filter((step) => step.enabled).sort((a, b) => a.stepOrder - b.stepOrder);
  if (!enabled.length || enabled.length > MAX_SEQUENCE_STEPS) return "SEQUENCE_STEP_COUNT_INVALID";
  for (let index = 0; index < enabled.length; index += 1) {
    const step = enabled[index];
    if (step.stepOrder !== index) return "SEQUENCE_ORDER_INVALID";
    if (index === 0 && (step.stepType !== "INITIAL" || step.delayMinutes !== 0)) return "INITIAL_STEP_INVALID";
    if (index > 0 && (step.stepType !== "FOLLOW_UP" || !Number.isInteger(step.delayMinutes) || step.delayMinutes < 1 || step.delayMinutes > 525600)) return "FOLLOW_UP_DELAY_INVALID";
    if (!step.subjectTemplate.trim() || step.subjectTemplate.length > 998) return "SUBJECT_INVALID";
    if (!step.bodyTextTemplate.trim() || step.bodyTextTemplate.length > 100000 || step.bodyTextTemplate.includes("\0")) return "BODY_INVALID";
  }
  return null;
}

export function nextEligibleAt(sentAt: string, delayMinutes: number): string | null {
  const timestamp = Date.parse(sentAt);
  if (!Number.isFinite(timestamp) || !Number.isInteger(delayMinutes) || delayMinutes < 0 || delayMinutes > 525600) return null;
  return new Date(timestamp + delayMinutes * 60_000).toISOString();
}

export function isTerminalEngagement(value: string): value is Exclude<CampaignEngagement, "ACTIVE"> {
  return ["REPLIED", "HARD_BOUNCED", "UNSUBSCRIBED", "COMPLETED", "CANCELLED"].includes(value);
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
export function isSafeThreadMetadata(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value) && !CONTROL.test(value);
}

export function sanitizeSpreadsheetCell(value: unknown): string | number | boolean {
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = value == null ? "" : String(value).replace(/\u0000/g, "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}
