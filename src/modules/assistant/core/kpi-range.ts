// Date ranges for the "kpi" tool, in Vietnam time (UTC+7, no daylight saving). Pure; unit-tested.

const VN = 7 * 3_600_000;
const DAY = 86_400_000;

export type KpiPeriod = "HOM_NAY" | "HOM_QUA" | "TUAN_NAY" | "TUAN_TRUOC" | "THANG_NAY" | "THANG_TRUOC" | "7_NGAY" | "30_NGAY";
export type KpiRange = { from: Date; to: Date; label: string } | { error: string };

/** Midnight (Vietnam) of the Vietnam calendar day containing `at`, as a UTC epoch. */
function vnDayStart(at: number) { return Math.floor((at + VN) / DAY) * DAY - VN; }
function parseDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const check = new Date(utc);
  if (check.getUTCMonth() !== Number(match[2]) - 1 || check.getUTCDate() !== Number(match[3])) return null;
  return utc - VN;
}
function show(start: number) { const d = new Date(start + VN); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; }
function range(from: number, to: number): KpiRange {
  const last = to - DAY;
  return { from: new Date(from), to: new Date(to), label: from === last ? show(from) : `${show(from)} – ${show(last)}` };
}

export function kpiRange(period: KpiPeriod | null, fromDay: string | null, toDay: string | null, now = Date.now()): KpiRange {
  const today = vnDayStart(now);
  const tomorrow = today + DAY;
  if (fromDay || toDay) {
    const from = fromDay ? parseDay(fromDay) : null;
    const until = toDay ? parseDay(toDay) : today;
    if ((fromDay && from === null) || until === null) return { error: "Ngày không hợp lệ (dùng YYYY-MM-DD)." };
    const start = from ?? until - 6 * DAY;
    if (start > until) return { error: "Ngày bắt đầu sau ngày kết thúc." };
    if (until - start > 366 * DAY) return { error: "Khoảng thời gian tối đa 1 năm." };
    return range(start, until + DAY);
  }
  const local = new Date(today + VN);
  const weekday = (local.getUTCDay() + 6) % 7; // Monday = 0
  const monthStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - VN;
  switch (period) {
    case "HOM_NAY": return range(today, tomorrow);
    case "HOM_QUA": return range(today - DAY, today);
    case "TUAN_NAY": return range(today - weekday * DAY, tomorrow);
    case "TUAN_TRUOC": return range(today - (weekday + 7) * DAY, today - weekday * DAY);
    case "THANG_NAY": return range(monthStart, tomorrow);
    case "THANG_TRUOC": return range(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1) - VN, monthStart);
    case "30_NGAY": return range(today - 29 * DAY, tomorrow);
    default: return range(today - 6 * DAY, tomorrow);
  }
}
