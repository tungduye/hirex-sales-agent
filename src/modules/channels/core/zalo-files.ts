// Files a person sends into a Zalo chat from HireX (pictures, CVs, documents). Shared by the upload route,
// the composer and the tests. Each file goes out as its own Zalo message, like picking files in Zalo.

/** HireX stores at most 25 MB per file (storage bucket limit). */
export const MAX_ZALO_FILE_BYTES = 25 * 1024 * 1024;
/** Files picked at once in the composer. */
export const MAX_ZALO_FILES_PER_SEND = 10;
/** Programs and scripts are never sent from HireX. */
const BLOCKED_EXTENSIONS = new Set(["exe", "msi", "bat", "cmd", "com", "scr", "pif", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "cpl", "reg", "lnk", "dll", "sys", "jar", "apk", "app", "sh"]);
const TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic", bmp: "image/bmp",
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", m4a: "audio/mp4",
};

export function fileExtension(name: string): string {
  return /\.([A-Za-z0-9]{1,10})$/u.exec(name)?.[1]?.toLowerCase() ?? "";
}

/** The name the recipient sees: no folders or control characters, at most 200 characters, keeps its extension. Null when unusable. */
export function zaloFileName(raw: string): string | null {
  const name = raw.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f]/gu, "").replace(/[<>:"/\\|?*]/gu, "_").replace(/^[.\s]+|[.\s]+$/gu, "");
  const extension = fileExtension(name);
  if (!name || !extension) return null;
  if (name.length <= 200) return name;
  return `${name.slice(0, 199 - extension.length).trimEnd()}.${extension}`;
}

export type ZaloFileProblem = "EMPTY" | "TOO_LARGE" | "NAME" | "BLOCKED_TYPE";

/** Why a file cannot be sent, or null when it can. */
export function zaloFileProblem(file: { name: string; size: number }): ZaloFileProblem | null {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return "EMPTY";
  if (file.size > MAX_ZALO_FILE_BYTES) return "TOO_LARGE";
  const name = zaloFileName(file.name);
  if (!name) return "NAME";
  if (BLOCKED_EXTENSIONS.has(fileExtension(name))) return "BLOCKED_TYPE";
  return null;
}

export const ZALO_FILE_PROBLEM_TEXT: Record<ZaloFileProblem, string> = {
  EMPTY: "Tệp trống.",
  TOO_LARGE: "Tệp lớn hơn 25 MB.",
  NAME: "Tên tệp cần có phần đuôi (ví dụ .pdf, .jpg).",
  BLOCKED_TYPE: "Không gửi tệp chương trình hoặc mã chạy (.exe, .bat, .js…).",
};

/** The declared type when it is well formed, otherwise one from the extension. */
export function zaloContentType(name: string, declared: string | null | undefined): string {
  const type = (declared ?? "").toLowerCase().split(";")[0]!.trim();
  if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(type) && type !== "application/octet-stream") return type;
  return TYPES[fileExtension(name)] ?? "application/octet-stream";
}

export function isZaloImage(name: string, contentType: string): boolean {
  return contentType.startsWith("image/") && ["jpg", "jpeg", "png", "gif", "webp"].includes(fileExtension(name));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
