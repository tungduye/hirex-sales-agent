"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createContactSchema } from "@/modules/crm/contacts/schemas/contact-schema";
import { companyBelongsToWorkspace } from "@/modules/crm/contacts/server/company-belongs-to-workspace";
import type { CreateContactState } from "@/modules/crm/contacts/types/create-contact-state";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export async function createContact(
  _previousState: CreateContactState,
  formData: FormData,
): Promise<CreateContactState> {
  const parsed = createContactSchema.safeParse({
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
    return {
      success: false,
      message: "Review the highlighted fields and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const account = await getAccountContext();

  if (!account?.workspaceId || !account.configurationComplete) {
    return { success: false, message: "Your account is not ready to create contacts." };
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

  const { error } = await supabase.from("contacts").insert({
    workspace_id: account.workspaceId,
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
  });

  if (error) {
    return { success: false, message: "Contact could not be created. Please try again." };
  }

  revalidatePath("/contacts");
  return { success: true, message: `${parsed.data.fullName} was added successfully.` };
}
