"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deleteContactChannelSchema } from "@/modules/crm/contact-channels/schemas/contact-channel-schema";
import { contactBelongsToWorkspace } from "@/modules/crm/contact-channels/server/contact-channel-access";
import type { DeleteContactChannelState } from "@/modules/crm/contact-channels/types/delete-contact-channel-state";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export async function deleteContactChannel(
  _previousState: DeleteContactChannelState,
  formData: FormData,
): Promise<DeleteContactChannelState> {
  const parsed = deleteContactChannelSchema.safeParse({
    contactId: formData.get("contactId"),
    channelId: formData.get("channelId"),
  });

  if (!parsed.success) {
    return { success: false, message: "This contact channel is not available. Refresh the page and try again." };
  }

  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) {
    return { success: false, message: "Your account is not ready to delete channels." };
  }

  const supabase = await createClient();
  const contactIsValid = await contactBelongsToWorkspace(supabase, parsed.data.contactId, account.workspaceId);
  if (!contactIsValid) {
    return { success: false, message: "This contact was not found or is no longer available." };
  }

  const { data, error } = await supabase
    .from("contact_channels")
    .delete()
    .eq("id", parsed.data.channelId)
    .eq("contact_id", parsed.data.contactId)
    .eq("workspace_id", account.workspaceId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { success: false, message: "Contact channel could not be deleted. Please try again." };
  }
  if (!data) {
    return { success: false, message: "This contact channel was not found or is no longer available." };
  }

  revalidatePath(`/contacts/${parsed.data.contactId}`);
  return { success: true, message: "Contact channel deleted successfully." };
}
