"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { updateContactSchema } from "@/modules/crm/contacts/schemas/contact-schema";
import { companyBelongsToWorkspace } from "@/modules/crm/contacts/server/company-belongs-to-workspace";
import type { ContactFormState } from "@/modules/crm/contacts/types/create-contact-state";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export async function updateContact(
  _previousState: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const parsed = updateContactSchema.safeParse({
    contactId: formData.get("contactId"),
    fullName: formData.get("fullName"),
    companyId: formData.get("companyId"),
    jobTitle: formData.get("jobTitle"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    country: formData.get("country"),
    language: formData.get("language"),
    source: formData.get("source"),
    leadStatus: formData.get("leadStatus"),
    leadScore: formData.get("leadScore"),
  });

  if (!parsed.success) {
    const errors = parsed.error.flatten();
    return {
      success: false,
      message: errors.fieldErrors.contactId
        ? "This contact is not available. Refresh the page and try again."
        : "Review the highlighted fields and try again.",
      fieldErrors: errors.fieldErrors,
    };
  }

  const account = await getAccountContext();

  if (!account?.workspaceId || !account.configurationComplete) {
    return { success: false, message: "Your account is not ready to update contacts." };
  }

  const supabase = await createClient();

  if (parsed.data.companyId) {
    const companyIsValid = await companyBelongsToWorkspace(
      supabase,
      parsed.data.companyId,
      account.workspaceId,
    );

    if (!companyIsValid) {
      return {
        success: false,
        message: "The selected company is not available in your workspace.",
        fieldErrors: { companyId: ["Select a valid company."] },
      };
    }
  }

  const { data, error } = await supabase
    .from("contacts")
    .update({
      company_id: parsed.data.companyId,
      full_name: parsed.data.fullName,
      job_title: parsed.data.jobTitle,
      email: parsed.data.email,
      phone: parsed.data.phone,
      country: parsed.data.country,
      language: parsed.data.language,
      source: parsed.data.source,
      lead_status: parsed.data.leadStatus,
      lead_score: parsed.data.leadScore,
    })
    .eq("id", parsed.data.contactId)
    .eq("workspace_id", account.workspaceId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { success: false, message: "Contact could not be updated. Please try again." };
  }

  if (!data) {
    return { success: false, message: "This contact was not found or is no longer available." };
  }

  revalidatePath("/contacts");
  return { success: true, message: `${parsed.data.fullName} was updated successfully.` };
}
