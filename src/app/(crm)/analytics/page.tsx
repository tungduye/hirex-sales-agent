import { getChannelDeliveryReport } from "@/modules/channels/server/get-channel-delivery-report";

const channelLabels: Record<string, string> = {
  EMAIL: "Email", FACEBOOK: "Facebook Page", FACEBOOK_PROFILE: "Facebook cá nhân", ZALO: "Zalo",
  WHATSAPP: "WhatsApp", VIBER: "Viber", TELEGRAM: "Telegram", OTHER: "Khác",
};
const number = (value: number) => value.toLocaleString("vi-VN");
const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

export default async function AnalyticsPage() {
  const data = await getChannelDeliveryReport();
  const { totals } = data;
  const cards: { label: string; value: number; hint: string; tone: string }[] = [
    { label: "Tổng lệnh gửi", value: totals.actions, hint: "Mọi tin đã được duyệt để gửi", tone: "text-slate-900" },
    { label: "Đã gửi", value: totals.sent, hint: `${percent(totals.sent, totals.actions)} tổng lệnh`, tone: "text-emerald-700" },
    { label: "Đang chờ", value: totals.pending, hint: "Chờ duyệt, chờ lượt hoặc đang gửi", tone: "text-slate-900" },
    { label: "Thất bại", value: totals.failed, hint: `${percent(totals.failed, totals.actions)} tổng lệnh`, tone: totals.failed > 0 ? "text-red-600" : "text-slate-900" },
    { label: "Chưa xác định", value: totals.unknown, hint: "Không chắc đã tới người nhận, không tự gửi lại", tone: totals.unknown > 0 ? "text-amber-600" : "text-slate-900" },
  ];
  const receipts = [
    ["Nhà cung cấp tiếp nhận", data.report.accepted], ["Đã giao", data.report.delivered], ["Đã đọc", data.report.read],
    ["Đã nhấp", data.report.clicked], ["Đã trả lời", data.report.replied],
  ] as const;

  return <div className="space-y-6">
    <header>
      <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Dữ liệu trực tiếp</p>
      <h1 className="text-3xl font-bold">Phân tích đa kênh</h1>
      <p className="text-sm text-slate-500">Số liệu tính từ các lệnh gửi qua Zalo, Facebook và Email. Biên nhận giao/đọc chỉ có khi nhà cung cấp gửi về.</p>
    </header>
    {data.error ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{data.error}</div> : null}
    {data.truncated ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">Đang tính trên 20.000 lệnh gửi gần nhất.</div> : null}

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => <div key={card.label} className="rounded-xl border bg-white p-5">
        <p className="text-sm text-slate-500">{card.label}</p>
        <p className={`mt-2 text-3xl font-bold tabular-nums ${card.tone}`}>{number(card.value)}</p>
        <p className="mt-1 text-xs text-slate-500">{card.hint}</p>
      </div>)}
    </div>

    <section className="overflow-hidden rounded-xl border bg-white">
      <div className="border-b px-5 py-4 font-semibold">Theo kênh</div>
      {data.byChannel.length > 0 ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
        <thead className="bg-slate-50 text-left text-slate-500"><tr>
          <th className="px-5 py-3 font-medium">Kênh</th>
          {["Lệnh gửi", "Đã gửi", "Đang chờ", "Thất bại", "Chưa xác định"].map((label) => <th key={label} className="px-5 py-3 text-right font-medium">{label}</th>)}
        </tr></thead>
        <tbody className="divide-y">{data.byChannel.map((row) => <tr key={row.channelType}>
          <td className="px-5 py-3 font-semibold">{channelLabels[row.channelType] ?? row.channelType}</td>
          <td className="px-5 py-3 text-right tabular-nums">{number(row.actions)}</td>
          <td className="px-5 py-3 text-right tabular-nums text-emerald-700">{number(row.sent)}</td>
          <td className="px-5 py-3 text-right tabular-nums">{number(row.pending)}</td>
          <td className={`px-5 py-3 text-right tabular-nums ${row.failed > 0 ? "text-red-600" : ""}`}>{number(row.failed)}</td>
          <td className={`px-5 py-3 text-right tabular-nums ${row.unknown > 0 ? "text-amber-600" : ""}`}>{number(row.unknown)}</td>
        </tr>)}</tbody>
      </table></div> : <p className="p-8 text-center text-sm text-slate-500">Chưa có dữ liệu gửi tin theo kênh.</p>}
    </section>

    <section className="rounded-xl border bg-white">
      <div className="border-b px-5 py-4 font-semibold">Biên nhận từ nhà cung cấp</div>
      {data.hasProviderEvents ? <div className="grid gap-3 p-5 sm:grid-cols-3 lg:grid-cols-5">
        {receipts.map(([label, value]) => <div key={label}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold tabular-nums">{number(value)}</p></div>)}
      </div> : <p className="p-5 text-sm text-slate-500">Chưa có biên nhận giao, đọc hoặc nhấp nào được nhà cung cấp gửi về. Các số ở trên vẫn chính xác theo trạng thái gửi.</p>}
    </section>
  </div>;
}
