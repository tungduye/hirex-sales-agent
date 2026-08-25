"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createCompanySchema } from "@/modules/crm/companies/schemas/company-schema";
import type { CreateCompanyState } from "@/modules/crm/companies/types/create-company-state";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export async function createCompany(
  _previousState: CreateCompanyState,
  formData: FormData,
): Promise<CreateCompanyState> {
  const parsed = createCompanySchema.safeParse({
    name: formData.get("name"),
    website: formData.get("website"),
    industry: formData.get("industry"),
    country: formData.get("country"),
    status: formData.get("status"),
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
    return {
      success: false,
      message: "Your account is not ready to create companies.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("companies").insert({
    workspace_id: account.workspaceId,
    name: parsed.data.name,
    website: parsed.data.website,
    industry: parsed.data.industry,
    country: parsed.data.country,
    status: parsed.data.status,
  });

  if (error) {
    return {
      success: false,
      message: "Company could not be created. Please try again.",
    };
  }

  revalidatePath("/companies");
  return {
    success: true,
    message: `${parsed.data.name} was added successfully.`,
  };
}
