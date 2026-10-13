"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createContactChannelSchema } from "@/modules/crm/contact-channels/schemas/contact-channel-schema";
import { contactBelongsToWorkspace } from "@/modules/crm/contact-channels/server/contact-channel-access";
import { restorePrimaryChannels, unsetPrimaryChannels } from "@/modules/crm/contact-channels/server/primary-management";
import type { CreateContactChannelState } from "@/modules/crm/contact-channels/types/create-contact-channel-state";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { requirePermission } from "@/modules/access/server/access-control";

export async function createContactChannel(
  _previousState: CreateContactChannelState,
  formData: FormData,
): Promise<CreateContactChannelState> {
  await requirePermission("contacts.update");
  const parsed = createContactChannelSchema.safeParse({
    contactId: formData.get("contactId"),
    channelType: formData.get("channelType"),
    channelValue: formData.get("channelValue"),
    isPrimary: formData.get("isPrimary"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: fieldErrors.contactId
        ? "This contact is not available. Refresh the page and try again."
        : "Review the highlighted fields and try again.",
      fieldErrors,
    };
  }

  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) {
    return { success: false, message: "Your account is not ready to add channels." };
  }

  const supabase = await createClient();
  const contactIsValid = await contactBelongsToWorkspace(
    supabase,
    parsed.data.contactId,
    account.workspaceId,
  );
  if (!contactIsValid) {
    return { success: false, message: "This contact was not found or is no longer available." };
  }

  const primaryScope = {
    workspaceId: account.workspaceId,
    contactId: parsed.data.contactId,
    channelType: parsed.data.channelType,
  };
  const primaryChange = parsed.data.isPrimary
    ? await unsetPrimaryChannels(supabase, primaryScope)
    : { success: true, previousPrimaryIds: [] };

  if (!primaryChange.success) {
    return { success: false, message: "The primary channel could not be changed. Please try again." };
  }

  const { error } = await supabase.from("contact_channels").insert({
    workspace_id: account.workspaceId,
    contact_id: parsed.data.contactId,
    channel_type: parsed.data.channelType,
    channel_value: parsed.data.channelValue,
    is_primary: parsed.data.isPrimary,
  });

  if (error) {
    const restored = await restorePrimaryChannels(
      supabase,
      primaryScope,
      primaryChange.previousPrimaryIds,
    );

    if (!restored) {
      return { success: false, message: "Contact channel could not be added, and its primary setting may need review." };
    }

    if (error.code === "23505") {
      return { success: false, message: "This channel already exists for this contact." };
    }
    return { success: false, message: "Contact channel could not be added. Please try again." };
  }

  revalidatePath(`/contacts/${parsed.data.contactId}`);
  return { success: true, message: "Contact channel added successfully." };
}
