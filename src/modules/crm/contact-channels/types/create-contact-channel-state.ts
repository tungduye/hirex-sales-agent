export type ContactChannelFormField = "contactId" | "channelId" | "channelType" | "channelValue" | "isPrimary";

export interface CreateContactChannelState {
  success: boolean;
  message: string | null;
  fieldErrors?: Partial<Record<ContactChannelFormField, string[]>>;
}

export const initialCreateContactChannelState: CreateContactChannelState = {
  success: false,
  message: null,
};

export const initialUpdateContactChannelState: CreateContactChannelState = {
  success: false,
  message: null,
};
