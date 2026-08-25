import { z } from "zod";
import { CHANNEL_TYPES } from "@/modules/crm/contact-channels/types/contact-channel";

export const contactIdSchema = z.uuid("Invalid contact identifier.");

export const createContactChannelSchema = z.object({
  contactId: contactIdSchema,
  channelType: z.enum(CHANNEL_TYPES),
  channelValue: z.string().trim().min(1, "Channel value is required.").max(500),
  isPrimary: z.preprocess(
    (value) => value === true || value === "on" || value === "true",
    z.boolean(),
  ),
}).superRefine((value, context) => {
  if (value.channelType === "EMAIL" && !z.email().safeParse(value.channelValue).success) {
    context.addIssue({
      code: "custom",
      path: ["channelValue"],
      message: "Enter a valid email address.",
    });
  }
});
