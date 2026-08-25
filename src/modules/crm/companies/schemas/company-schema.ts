import { z } from "zod";
import { COMPANY_STATUSES } from "@/modules/crm/companies/types/company";

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((value) => value || null);

export const companyFieldsSchema = z.object({
  name: z.string().trim().min(1, "Company name is required.").max(200),
  website: optionalText(500),
  industry: optionalText(120),
  country: optionalText(120),
  status: z.enum(COMPANY_STATUSES),
});

export const createCompanySchema = companyFieldsSchema;

export const updateCompanySchema = companyFieldsSchema.extend({
  companyId: z.uuid("Invalid company identifier."),
});

export const deleteCompanySchema = z.object({
  companyId: z.uuid("Invalid company identifier."),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
