export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "ENGAGED",
  "QUALIFIED",
  "OPPORTUNITY",
  "WON",
  "LOST",
  "DO_NOT_CONTACT",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface Contact {
  id: string;
  fullName: string;
  initials: string;
  company: string;
  jobTitle: string;
  email: string;
  phone: string;
  country: string;
  source: string;
  leadStatus: LeadStatus;
  leadScore: number;
  lastActivity: string;
}

export interface Activity {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  type: "contact" | "company" | "status" | "task";
}
