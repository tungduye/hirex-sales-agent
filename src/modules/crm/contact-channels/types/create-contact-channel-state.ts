export type ContactChannelFormField = "contactId" | "channelType" | "channelValue" | "isPrimary";

export interface CreateContactChannelState {
  success: boolean;
  message: string | null;
  fieldErrors?: Partial<Record<ContactChannelFormField, string[]>>;
}

export const initialCreateContactChannelState: CreateContactChannelState = {
  success: false,
  message: null,
};
