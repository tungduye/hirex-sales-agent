import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { describeSendLock, type ZaloSendLock } from "../core/send-locks";

/** Warning listing Zalo nicks that cannot send right now. Renders nothing when no nick is locked. */
export function ZaloSendLockAlert({ locks, now, compact = false }: { locks: ZaloSendLock[]; now: number; compact?: boolean }) {
  if (locks.length === 0) return null;
  if (compact) {
    const lock = locks[0]!;
    return <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><LockKeyhole className="mt-0.5 size-3.5 shrink-0"/><span><b>Nick {lock.accountName} đang bị khoá gửi tin.</b> {describeSendLock(lock, now)}</span></p>;
  }
  return <section role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
    <h2 className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole className="size-4"/>{locks.length === 1 ? "1 nick Zalo đang bị khoá gửi tin" : `${locks.length} nick Zalo đang bị khoá gửi tin`}</h2>
    <ul className="mt-2 space-y-1.5 text-sm">{locks.map((lock) => <li key={lock.channelAccountId} className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-semibold">{lock.accountName}</span><span className="text-amber-900">{describeSendLock(lock, now)}</span>
      {lock.conversationId ? <Link href={`/inbox/all/${lock.conversationId}`} className="text-xs font-semibold text-amber-800 underline underline-offset-2">Xem tin</Link> : null}
    </li>)}</ul>
  </section>;
}
