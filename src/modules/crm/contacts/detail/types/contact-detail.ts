import type { Contact } from "@/modules/crm/contacts/types/contact";

export interface ContactDetail extends Contact {
  companyName: string | null;
  initials: string;
}

export type GetContactDetailResult =
  | { status: "ok"; contact: ContactDetail }
  | { status: "not_found" }
  | { status: "error"; message: string };
