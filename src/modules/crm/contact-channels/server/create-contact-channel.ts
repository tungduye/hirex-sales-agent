"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createContactChannelSchema } from "@/modules/crm/contact-channels/schemas/contact-channel-schema";
import type { CreateContactChannelState } from "@/modules/crm/contact-channels/types/create-contact-channel-state";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export async function createContactChannel(
  _previousState: CreateContactChannelState,
  formData: FormData,
): Promise<CreateContactChannelState> {
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
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", parsed.data.contactId)
    .eq("workspace_id", account.workspaceId)
    .maybeSingle();

  if (contactError || !contact) {
    return { success: false, message: "This contact was not found or is no longer available." };
  }

  const { error } = await supabase.from("contact_channels").insert({
    workspace_id: account.workspaceId,
    contact_id: parsed.data.contactId,
    channel_type: parsed.data.channelType,
    channel_value: parsed.data.channelValue,
    is_primary: parsed.data.isPrimary,
  });

  if (error?.code === "23505") {
    if (error.message.includes("contact_channels_one_primary_per_type_idx")) {
      return { success: false, message: "A primary channel of this type already exists." };
    }
    return { success: false, message: "This channel already exists for this contact." };
  }

  if (error) {
    return { success: false, message: "Contact channel could not be added. Please try again." };
  }

  revalidatePath(`/contacts/${parsed.data.contactId}`);
  return { success: true, message: "Contact channel added successfully." };
}
