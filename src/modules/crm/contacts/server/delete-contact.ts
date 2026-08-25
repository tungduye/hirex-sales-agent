"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deleteContactSchema } from "@/modules/crm/contacts/schemas/contact-schema";
import type { DeleteContactState } from "@/modules/crm/contacts/types/delete-contact-state";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export async function deleteContact(
  _previousState: DeleteContactState,
  formData: FormData,
): Promise<DeleteContactState> {
  const parsed = deleteContactSchema.safeParse({ contactId: formData.get("contactId") });

  if (!parsed.success) {
    return { success: false, message: "This contact is not available. Refresh the page and try again." };
  }

  const account = await getAccountContext();

  if (!account?.workspaceId || !account.configurationComplete) {
    return { success: false, message: "Your account is not ready to delete contacts." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", parsed.data.contactId)
    .eq("workspace_id", account.workspaceId)
    .select("id")
    .maybeSingle();

  if (error?.code === "23503") {
    return {
      success: false,
      message: "This contact cannot be deleted because it still has related data.",
    };
  }

  if (error) {
    return { success: false, message: "Contact could not be deleted. Please try again." };
  }

  if (!data) {
    return { success: false, message: "This contact was not found or is no longer available." };
  }

  revalidatePath("/contacts");
  return { success: true, message: "Contact was deleted successfully." };
}
