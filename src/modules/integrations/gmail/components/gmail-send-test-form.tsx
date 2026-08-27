"use client";

import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GmailSendResult } from "@/modules/integrations/gmail/types/send-message";

interface Props {
  emailAccountId: string;
}

export function GmailSendTestForm({ emailAccountId }: Props) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<GmailSendResult | null>(null);
  const deliveryUnknown = outcome?.code === "DELIVERY_STATUS_UNKNOWN"
    || outcome?.code === "SEND_IN_PROGRESS";
  const definitiveComplete = Boolean(outcome) && !deliveryUnknown;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || deliveryUnknown || definitiveComplete) return;
    setSubmitting(true);
    setOutcome(null);
    try {
      const response = await fetch("/api/integrations/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailAccountId, idempotencyKey, to, subject, bodyText }),
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        setOutcome(definitiveRequestError(response.status));
      } else {
        setOutcome(isSafeSendResult(value) ? value : unknownDeliveryResult());
      }
    } catch {
      setOutcome(unknownDeliveryResult());
    } finally {
      setSubmitting(false);
    }
  }

  function startAnotherMessage() {
    if (!definitiveComplete) return;
    setIdempotencyKey(crypto.randomUUID());
    setTo("");
    setSubject("");
    setBodyText("");
    setOutcome(null);
  }

  return (
    <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Send className="size-4 text-blue-600" />Test Gmail sending
      </div>
      <p className="mt-1 text-xs text-slate-500">Manually send one new plain-text email. There is no automatic retry.</p>

      <form className="mt-4 grid gap-3" onSubmit={handleSubmit}>
        <label className="grid gap-1 text-xs font-medium text-slate-700">
          To
          <input className="h-10 rounded-lg border bg-white px-3 text-sm outline-none focus:border-blue-500" type="email" value={to} onChange={(event) => setTo(event.target.value)} maxLength={254} required disabled={submitting || Boolean(outcome)} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-700">
          Subject
          <input className="h-10 rounded-lg border bg-white px-3 text-sm outline-none focus:border-blue-500" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} required disabled={submitting || Boolean(outcome)} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-700">
          Plain-text message
          <textarea className="min-h-28 resize-y rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" value={bodyText} onChange={(event) => setBodyText(event.target.value)} maxLength={100000} required disabled={submitting || Boolean(outcome)} />
        </label>

        {outcome && (
          <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${outcome.success ? "border-emerald-200 bg-emerald-50 text-emerald-700" : deliveryUnknown ? "border-amber-300 bg-amber-50 text-amber-800" : "border-rose-200 bg-rose-50 text-rose-700"}`} role={outcome.success ? "status" : "alert"}>
            {outcome.success ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
            <span>{outcome.message}{deliveryUnknown ? " Do not submit this message again." : ""}</span>
          </div>
        )}

        <div className="flex justify-end">
          {definitiveComplete ? (
            <Button type="button" variant="outline" onClick={startAnotherMessage}>Start another message</Button>
          ) : (
            <Button type="submit" disabled={submitting || deliveryUnknown}>
              <Send className="size-4" />{submitting ? "Sending..." : "Send one test email"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function isSafeSendResult(value: unknown): value is GmailSendResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.success === "boolean"
    && typeof result.code === "string"
    && typeof result.message === "string"
    && (result.sendRequestId === null || typeof result.sendRequestId === "string");
}

function unknownDeliveryResult(): GmailSendResult {
  return {
    success: false,
    code: "DELIVERY_STATUS_UNKNOWN",
    message: "Delivery status is unknown.",
    sendRequestId: null,
  };
}

function definitiveRequestError(status: number): GmailSendResult {
  return {
    success: false,
    code: status === 400 ? "INVALID_RECIPIENT" : "GMAIL_SEND_REJECTED",
    message: status === 400
      ? "Check the recipient, subject, and plain-text message."
      : "The send request was rejected before delivery.",
    sendRequestId: null,
  };
}
