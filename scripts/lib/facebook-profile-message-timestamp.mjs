export function facebookProfileMessageTimestamp({ datetime, unixTimestamp, fallback = new Date().toISOString() }) {
  if (typeof datetime === "string" && datetime.trim()) {
    const milliseconds = Date.parse(datetime);
    if (Number.isFinite(milliseconds)) return { occurredAt: new Date(milliseconds).toISOString(), verified: true };
  }

  if (typeof unixTimestamp === "string" && /^\d{9,13}$/u.test(unixTimestamp)) {
    const value = Number(unixTimestamp);
    const milliseconds = unixTimestamp.length <= 10 ? value * 1000 : value;
    if (Number.isSafeInteger(milliseconds) && milliseconds > 0) {
      return { occurredAt: new Date(milliseconds).toISOString(), verified: true };
    }
  }

  return { occurredAt: fallback, verified: false };
}
