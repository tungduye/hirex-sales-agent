"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { updateCompanySchema } from "@/modules/crm/companies/schemas/company-schema";
import type { CompanyFormState } from "@/modules/crm/companies/types/create-company-state";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export async function updateCompany(
  _previousState: CompanyFormState,
  formData: FormData,
): Promise<CompanyFormState> {
  const parsed = updateCompanySchema.safeParse({
    companyId: formData.get("companyId"),
    name: formData.get("name"),
    website: formData.get("website"),
    industry: formData.get("industry"),
    country: formData.get("country"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    const errors = parsed.error.flatten();
    return {
      success: false,
      message: errors.fieldErrors.companyId
        ? "This company is not available. Refresh the page and try again."
        : "Review the highlighted fields and try again.",
      fieldErrors: errors.fieldErrors,
    };
  }

  const account = await getAccountContext();

  if (!account?.workspaceId || !account.configurationComplete) {
    return { success: false, message: "Your account is not ready to update companies." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .update({
      name: parsed.data.name,
      website: parsed.data.website,
      industry: parsed.data.industry,
      country: parsed.data.country,
      status: parsed.data.status,
    })
    .eq("id", parsed.data.companyId)
    .eq("workspace_id", account.workspaceId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { success: false, message: "Company could not be updated. Please try again." };
  }

  if (!data) {
    return { success: false, message: "This company was not found or is no longer available." };
  }

  revalidatePath("/companies");
  return { success: true, message: `${parsed.data.name} was updated successfully.` };
}
