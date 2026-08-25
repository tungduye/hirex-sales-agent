"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { updateContactChannelSchema } from "@/modules/crm/contact-channels/schemas/contact-channel-schema";
import { contactBelongsToWorkspace, getChannelForMutation } from "@/modules/crm/contact-channels/server/contact-channel-access";
import { restorePrimaryChannels, unsetPrimaryChannels } from "@/modules/crm/contact-channels/server/primary-management";
import type { CreateContactChannelState } from "@/modules/crm/contact-channels/types/create-contact-channel-state";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export async function updateContactChannel(
  _previousState: CreateContactChannelState,
  formData: FormData,
): Promise<CreateContactChannelState> {
  const parsed = updateContactChannelSchema.safeParse({
    contactId: formData.get("contactId"),
    channelId: formData.get("channelId"),
    channelType: formData.get("channelType"),
    channelValue: formData.get("channelValue"),
    isPrimary: formData.get("isPrimary"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: fieldErrors.contactId || fieldErrors.channelId
        ? "This contact channel is not available. Refresh the page and try again."
        : "Review the highlighted fields and try again.",
      fieldErrors,
    };
  }

  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) {
    return { success: false, message: "Your account is not ready to update channels." };
  }

  const supabase = await createClient();
  const contactIsValid = await contactBelongsToWorkspace(supabase, parsed.data.contactId, account.workspaceId);
  if (!contactIsValid) {
    return { success: false, message: "This contact was not found or is no longer available." };
  }

  const channel = await getChannelForMutation(
    supabase,
    parsed.data.channelId,
    parsed.data.contactId,
    account.workspaceId,
  );
  if (!channel) {
    return { success: false, message: "This contact channel was not found or is no longer available." };
  }

  const primaryScope = {
    workspaceId: account.workspaceId,
    contactId: parsed.data.contactId,
    channelType: parsed.data.channelType,
    excludeChannelId: parsed.data.channelId,
  };
  const primaryChange = parsed.data.isPrimary
    ? await unsetPrimaryChannels(supabase, primaryScope)
    : { success: true, previousPrimaryIds: [] };

  if (!primaryChange.success) {
    return { success: false, message: "The primary channel could not be changed. Please try again." };
  }

  const { data, error } = await supabase
    .from("contact_channels")
    .update({
      channel_type: parsed.data.channelType,
      channel_value: parsed.data.channelValue,
      is_primary: parsed.data.isPrimary,
    })
    .eq("id", parsed.data.channelId)
    .eq("contact_id", parsed.data.contactId)
    .eq("workspace_id", account.workspaceId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    const restored = await restorePrimaryChannels(
      supabase,
      primaryScope,
      primaryChange.previousPrimaryIds,
    );

    if (!restored) {
      return { success: false, message: "Contact channel could not be updated, and its primary setting may need review." };
    }
    if (error?.code === "23505") {
      return { success: false, message: "This channel already exists for this contact." };
    }
    return { success: false, message: "Contact channel could not be updated. Please try again." };
  }

  revalidatePath(`/contacts/${parsed.data.contactId}`);
  return { success: true, message: "Contact channel updated successfully." };
}
