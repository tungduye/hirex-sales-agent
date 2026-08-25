export type ContactFormField =
  | "fullName"
  | "companyId"
  | "jobTitle"
  | "email"
  | "phone"
  | "country"
  | "language"
  | "source"
  | "leadStatus"
  | "leadScore";

export interface CreateContactState {
  success: boolean;
  message: string | null;
  fieldErrors?: Partial<Record<ContactFormField, string[]>>;
}

export const initialCreateContactState: CreateContactState = {
  success: false,
  message: null,
};
