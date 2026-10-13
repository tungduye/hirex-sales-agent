// How a generation batch is shown in the library ("Yêu cầu gần đây"). Pure; unit-tested.

export interface ContentBatchSummary {
  id: string;
  jobTitle: string;
  quantity: number;
  status: string;
  savedCount: number;
  rejectedCount: number;
  errorCode: string | null;
  createdAt: string;
}

/** A batch still PENDING after this long was cut off (server restart) and will never finish. */
export const STALE_BATCH_MS = 15 * 60_000;

const ERROR_TEXT: Record<string, string> = {
  ALL_TOO_SIMILAR: "Tất cả content đều trùng quá 50% với kho nên không được lưu. Hãy đổi điểm nổi bật, phong cách hoặc định dạng rồi thử lại.",
  AI_NOT_CONFIGURED: "Máy chủ chưa cấu hình OpenAI.",
  AI_UNAVAILABLE: "Dịch vụ AI không phản hồi. Vui lòng thử lại sau ít phút.",
  AI_INVALID_OUTPUT: "AI trả về kết quả không hợp lệ. Vui lòng thử lại.",
  LIBRARY_UNAVAILABLE: "Không đọc được kho để kiểm tra trùng lặp. Vui lòng thử lại.",
  LIBRARY_TOO_LARGE: "Kho content quá lớn để kiểm tra trùng lặp. Liên hệ quản trị viên.",
  SAVE_FAILED: "Không lưu được content vào kho. Vui lòng thử lại.",
};

export type BatchTone = "running" | "success" | "warning" | "error";

export function isBatchRunning(batch: Pick<ContentBatchSummary, "status" | "createdAt">, now: number) {
  return batch.status === "PENDING" && now - Date.parse(batch.createdAt) < STALE_BATCH_MS;
}

export function batchStatus(batch: ContentBatchSummary, now: number): { tone: BatchTone; text: string } {
  if (batch.status === "PENDING") {
    return isBatchRunning(batch, now)
      ? { tone: "running", text: `Đang viết ${batch.quantity} content và kiểm tra trùng lặp…` }
      : { tone: "error", text: "Yêu cầu bị gián đoạn (máy chủ khởi động lại). Vui lòng tạo lại." };
  }
  if (batch.status === "COMPLETED") return { tone: "success", text: `Đã lưu ${batch.savedCount}/${batch.quantity} content.` };
  if (batch.status === "PARTIAL") {
    return { tone: "warning", text: `Đã lưu ${batch.savedCount}/${batch.quantity} content. ${batch.rejectedCount} content bị loại vì trùng quá 50% sau 2 lần viết lại.` };
  }
  return { tone: "error", text: ERROR_TEXT[batch.errorCode ?? ""] ?? "Không tạo được content. Vui lòng thử lại." };
}
