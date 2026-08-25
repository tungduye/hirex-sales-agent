"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deleteCompanySchema } from "@/modules/crm/companies/schemas/company-schema";
import type { DeleteCompanyState } from "@/modules/crm/companies/types/delete-company-state";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export async function deleteCompany(
  _previousState: DeleteCompanyState,
  formData: FormData,
): Promise<DeleteCompanyState> {
  const parsed = deleteCompanySchema.safeParse({ companyId: formData.get("companyId") });

  if (!parsed.success) {
    return { success: false, message: "This company is not available. Refresh the page and try again." };
  }

  const account = await getAccountContext();

  if (!account?.workspaceId || !account.configurationComplete) {
    return { success: false, message: "Your account is not ready to delete companies." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .delete()
    .eq("id", parsed.data.companyId)
    .eq("workspace_id", account.workspaceId)
    .select("id")
    .maybeSingle();

  if (error?.code === "23503") {
    return {
      success: false,
      message: "This company cannot be deleted because it still has contacts.",
    };
  }

  if (error) {
    return { success: false, message: "Company could not be deleted. Please try again." };
  }

  if (!data) {
    return { success: false, message: "This company was not found or is no longer available." };
  }

  revalidatePath("/companies");
  return { success: true, message: "Company was deleted successfully." };
}
