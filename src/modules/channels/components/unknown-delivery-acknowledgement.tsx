"use client";

import { useActionState } from "react";
import { acknowledgeZaloDeliveryUnknown } from "../server/channel-actions";
import type { ChannelActionState } from "../types/channel-action-state";

const initial: ChannelActionState = { status: "idle", message: null };

export function UnknownDeliveryAcknowledgement({ actionId }: { actionId: string }) {
  const [state, action, pending] = useActionState(acknowledgeZaloDeliveryUnknown, initial);
  return <form action={action} className="mt-2"><input type="hidden" name="actionId" value={actionId}/>
    <button disabled={pending} className="rounded bg-white/20 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50">
      {pending ? "Đang xác nhận…" : "Xác nhận không gửi lại"}
    </button>{state.message ? <span className="mt-1 block text-[10px] text-white/90">{state.message}</span> : null}</form>;
}
