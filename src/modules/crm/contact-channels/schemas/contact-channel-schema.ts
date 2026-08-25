import { z } from "zod";
import { CHANNEL_TYPES } from "@/modules/crm/contact-channels/types/contact-channel";

export const contactIdSchema = z.uuid("Invalid contact identifier.");
export const channelIdSchema = z.uuid("Invalid channel identifier.");

const channelFieldsSchema = z.object({
  channelType: z.enum(CHANNEL_TYPES),
  channelValue: z.string().trim().min(1, "Channel value is required.").max(500),
  isPrimary: z.preprocess(
    (value) => value === true || value === "on" || value === "true",
    z.boolean(),
  ),
});

function validateEmailChannel(
  value: z.infer<typeof channelFieldsSchema>,
  context: z.RefinementCtx,
) {
  if (value.channelType === "EMAIL" && !z.email().safeParse(value.channelValue).success) {
    context.addIssue({
      code: "custom",
      path: ["channelValue"],
      message: "Enter a valid email address.",
    });
  }
}

export const createContactChannelSchema = channelFieldsSchema
  .extend({ contactId: contactIdSchema })
  .superRefine(validateEmailChannel);

export const updateContactChannelSchema = channelFieldsSchema
  .extend({ contactId: contactIdSchema, channelId: channelIdSchema })
  .superRefine(validateEmailChannel);

export const deleteContactChannelSchema = z.object({
  contactId: contactIdSchema,
  channelId: channelIdSchema,
});
