import { z } from "zod";

const HEADER_LINE_BREAK = /[\r\n]/;

export const sendNewMessageSchema = z.object({
  emailAccountId: z.uuid(),
  idempotencyKey: z.uuid(),
  to: z.string()
    .trim()
    .min(1)
    .max(254)
    .refine((value) => !HEADER_LINE_BREAK.test(value) && !value.includes(","), "Invalid recipient.")
    .pipe(z.email())
    .transform((value) => value.toLowerCase()),
  subject: z.string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !HEADER_LINE_BREAK.test(value), "Invalid subject."),
  bodyText: z.string()
    .max(100_000)
    .refine((value) => value.trim().length > 0, "Message is required."),
}).strict();

export type SendNewMessageInput = z.infer<typeof sendNewMessageSchema>;
