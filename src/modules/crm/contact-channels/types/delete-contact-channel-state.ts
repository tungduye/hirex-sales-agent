export interface DeleteContactChannelState {
  success: boolean;
  message: string | null;
}

export const initialDeleteContactChannelState: DeleteContactChannelState = {
  success: false,
  message: null,
};
