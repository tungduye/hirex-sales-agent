import { z } from "zod";
import { LEAD_STATUSES } from "@/types/crm";

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((value) => value || null);

const optionalEmail = z
  .string()
  .trim()
  .max(320)
  .refine((value) => value === "" || z.email().safeParse(value).success, "Enter a valid email address.")
  .transform((value) => value || null);

const optionalCompanyId = z
  .union([z.literal(""), z.uuid("Select a valid company.")])
  .transform((value) => value || null);

export const createContactSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required.").max(200),
  companyId: optionalCompanyId,
  jobTitle: optionalText(200),
  email: optionalEmail,
  phone: optionalText(50),
  country: optionalText(120),
  language: optionalText(80),
  source: optionalText(120),
  leadStatus: z.enum(LEAD_STATUSES),
  leadScore: z.preprocess(
    (value) => value === "" || value === null ? 0 : value,
    z.coerce.number().int("Lead score must be a whole number.").min(0).max(100),
  ),
});
