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

export interface ContactFormState {
  success: boolean;
  message: string | null;
  fieldErrors?: Partial<Record<ContactFormField, string[]>>;
}

export type CreateContactState = ContactFormState;

export const initialCreateContactState: CreateContactState = {
  success: false,
  message: null,
};

export const initialUpdateContactState: ContactFormState = {
  success: false,
  message: null,
};
