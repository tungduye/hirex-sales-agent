export type CompanyFormField = "name" | "website" | "industry" | "country" | "status";

export interface CompanyFormState {
  success: boolean;
  message: string | null;
  fieldErrors?: Partial<Record<CompanyFormField, string[]>>;
}

export type CreateCompanyState = CompanyFormState;

export const initialCreateCompanyState: CreateCompanyState = {
  success: false,
  message: null,
};

export const initialUpdateCompanyState: CompanyFormState = {
  success: false,
  message: null,
};
