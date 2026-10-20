// What a member may enter for an event (web form and Trợ lý share it). Pure; unit-tested.
import { z } from "zod";
import { EVENT_KINDS, RECURRENCES } from "./calendar.ts";

const uuid = z.string().uuid();
const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null).nullable();

export const eventInputSchema = z.object({
  title: z.string().trim().min(1, "Cần tiêu đề.").max(200),
  kind: z.enum(EVENT_KINDS),
  startsAt: z.number().int().positive(),
  durationMinutes: z.number().int().min(5, "Tối thiểu 5 phút.").max(1440, "Tối đa 24 giờ."),
  location: optionalText(300),
  note: optionalText(2000),
  recurrence: z.enum(RECURRENCES),
  recurrenceDays: z.array(z.number().int().min(1).max(7)).max(7),
  recurrenceUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
  attendeeIds: z.array(uuid).max(50, "Tối đa 50 người tham gia."),
  contactId: uuid.nullable(),
  conversationId: uuid.nullable(),
}).strict().superRefine((value, context) => {
  if (value.recurrence === "NONE" && (value.recurrenceDays.length || value.recurrenceUntil)) context.addIssue({ code: "custom", message: "Lịch không lặp thì không chọn ngày lặp." });
  if (value.recurrenceUntil && Date.parse(`${value.recurrenceUntil}T23:59:59+07:00`) < value.startsAt) context.addIssue({ code: "custom", message: "Ngày kết thúc lặp phải sau ngày bắt đầu." });
});
export type EventInput = z.infer<typeof eventInputSchema>;

export function checkEventInput(value: unknown): { ok: true; value: EventInput } | { ok: false; error: string } {
  const parsed = eventInputSchema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message ?? "Thông tin lịch chưa hợp lệ." };
}
