export function isGmailDeliveryNotice(from: string | null) {
  return /^(mailer-daemon|postmaster)@(googlemail|gmail)\.com$/i.test(from ?? '');
}

export function isHiddenSystemEmail(row: { from_email: string | null; auto_submitted?: string | null; body_text?: string | null; snippet?: string | null }) {
  if(isGmailDeliveryNotice(row.from_email)) return true;
  const text=row.body_text??row.snippet??'';
  const automatic=/^auto-(generated|replied)(;|$)/i.test(row.auto_submitted??'');
  const acknowledgement=/acknowledge that we have received your request|ticket has been created|お問い合わせ.*(受け付け|受付|自動送信)|đã nhận được (yêu cầu|liên hệ).*tự động/i.test(text);
  const advertising=/^advertise-noreply@/i.test(row.from_email??'') && /how businesses like yours|advertis|marketing/i.test(text);
  return (automatic && acknowledgement) || advertising;
}

export function isGmailQuotaNotice(from: string | null, text: string | null) {
  return /^(mailer-daemon|postmaster)@(googlemail|gmail)\.com$/i.test(from ?? '') &&
    /reached a limit for sending mail|đạt đến giới hạn gửi thư/i.test(text ?? '');
}

export function vietnamDayStart(now = new Date()) {
  const offset = 7 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + offset);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset).toISOString();
}
