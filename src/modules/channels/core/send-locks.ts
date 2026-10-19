// A Zalo nick the adapter has locked: no message can be sent from it until the lock is settled.
// Locks are settled automatically by scripts/reconcile-zalo-send-locks.mjs; this only describes them.

export interface ZaloSendLock {
  channelAccountId: string;
  accountName: string;
  reason: "DELIVERY_UNKNOWN" | "SENDING";
  lockedSince: string;
  autoReleaseAt: string | null;
  conversationId: string | null;
}

function clock(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
}

export function lockAge(since: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} giờ` : `${Math.floor(hours / 24)} ngày`;
}

/** One line on why the nick is locked and what happens next. */
export function describeSendLock(lock: ZaloSendLock, now: number) {
  const age = lockAge(lock.lockedSince, now);
  if (lock.reason === "SENDING") return `Đang gửi một tin (${age}). Các tin khác của nick này chờ đến khi tin đó xong.`;
  const release = lock.autoReleaseAt && Date.parse(lock.autoReleaseAt) > now
    ? `HireX đang đối chiếu với Zalo; nếu không thấy tin, nick tự mở khoá lúc ${clock(lock.autoReleaseAt)} (tin đó không gửi lại).`
    : "HireX đang đối chiếu với Zalo và sẽ tự mở khoá trong ít phút (tin đó không gửi lại).";
  return `Tin gửi lúc ${clock(lock.lockedSince)} chưa rõ đã tới khách chưa (${age}). ${release}`;
}
