export interface CreateCompanyState {
  success: boolean;
  message: string | null;
  fieldErrors?: Partial<
    Record<"name" | "website" | "industry" | "country" | "status", string[]>
  >;
}

export const initialCreateCompanyState: CreateCompanyState = {
  success: false,
  message: null,
};
