export interface DeleteCompanyState {
  success: boolean;
  message: string | null;
}

export const initialDeleteCompanyState: DeleteCompanyState = {
  success: false,
  message: null,
};
