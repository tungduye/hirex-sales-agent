export interface DeleteContactState {
  success: boolean;
  message: string | null;
}

export const initialDeleteContactState: DeleteContactState = {
  success: false,
  message: null,
};
