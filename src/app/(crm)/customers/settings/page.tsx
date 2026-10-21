import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { HumanApiSettings } from "@/modules/human-documents/components/api-controls";
import { AddBlockForm, CvPinRunButtons, CvPinSettingsForm, ImportCodesForm, UserLinksForm } from "@/modules/customers/components/settings-forms";
import { decidePartnerGroup, updateCustomerBlock } from "@/modules/customers/server/customer-actions";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { sodaGroups } from "@/modules/customers/server/cv-pins";
import { customerContext } from "@/modules/customers/server/customer-data";

const time = (value: string | null) => value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—";
const ERRORS: Record<string, string> = { NO_TOKEN: "Chưa có token Human", NO_BLOCKS: "Chưa bật khối nào", HUMAN_TOKEN_EXPIRED: "Token Human hết hạn", SAVE_FAILED: "Lỗi lưu dữ liệu" };

export default async function CustomerSettingsPage() {
  const context = await customerContext();
  if (!context?.canManage) redirect("/customers");
  const db = await createClient();
  const [{ data: blocks }, { data: links }, { data: members }, { data: syncs }, { data: owners }, { count: codeCount }, { data: facets }] = await Promise.all([
    db.from("human_partner_blocks").select("block_id,name,enabled,last_synced_at,last_count,last_error").eq("workspace_id", context.workspaceId).order("sort").order("block_id"),
    db.from("human_user_links").select("human_user_id,human_name,profile_id").eq("workspace_id", context.workspaceId).order("human_name"),
    db.from("profiles").select("id,full_name").eq("workspace_id", context.workspaceId).order("full_name"),
    db.from("human_partner_syncs").select("id,trigger,started_at,finished_at,ok,rows,error").eq("workspace_id", context.workspaceId).order("started_at", { ascending: false }).limit(10),
    db.rpc("human_partner_owner_counts"),
    db.from("human_master_codes").select("master_id", { count: "exact", head: true }).eq("workspace_id", context.workspaceId),
    db.rpc("human_partner_facets"),
  ]);
  // Soda (Trợ lý) groups and which company each belongs to.
  const [{ nick, groups }, { data: groupLinks }, { data: pinSettings }, partnerPage1, partnerPage2] = await Promise.all([
    sodaGroups(createPrivilegedClient(), context.workspaceId),
    db.from("human_partner_groups").select("group_id,partner_id,status,score").eq("workspace_id", context.workspaceId).neq("status", "REJECTED").limit(5000),
    db.from("human_cv_pin_settings").select("enabled,run_hour,run_minute,last_run_at,last_result").eq("workspace_id", context.workspaceId).maybeSingle(),
    db.from("human_partners").select("partner_id,name").eq("workspace_id", context.workspaceId).eq("active", true).order("name").range(0, 999),
    db.from("human_partners").select("partner_id,name").eq("workspace_id", context.workspaceId).eq("active", true).order("name").range(1000, 1999),
  ]);
  const partnerName = new Map([...(partnerPage1.data ?? []), ...(partnerPage2.data ?? [])].map((row) => [Number(row.partner_id), String(row.name ?? `Khách #${row.partner_id}`)]));
  const linksByGroup = new Map<string, Array<{ partnerId: number; status: string; score: number }>>();
  for (const row of (groupLinks ?? []) as Array<{ group_id: string; partner_id: number; status: string; score: number }>) linksByGroup.set(row.group_id, [...(linksByGroup.get(row.group_id) ?? []), { partnerId: Number(row.partner_id), status: row.status, score: row.score }]);
  const groupRows = groups.map((group) => ({ ...group, links: (linksByGroup.get(group.groupId) ?? []).sort((a, b) => Number(b.status === "CONFIRMED") - Number(a.status === "CONFIRMED") || b.score - a.score) }))
    .sort((a, b) => Number(a.links.some((link) => link.status === "CONFIRMED")) - Number(b.links.some((link) => link.status === "CONFIRMED")) || Number(b.links.length > 0) - Number(a.links.length > 0));
  const confirmedCount = groupRows.filter((group) => group.links.some((link) => link.status === "CONFIRMED")).length;
  const pinTime = `${String(pinSettings?.run_hour ?? 8).padStart(2, "0")}:${String(pinSettings?.run_minute ?? 30).padStart(2, "0")}`;
  // Codes still shown as "Mã 123" on the list (not in the bộ mã yet).
  const unknown = [...new Set(((facets ?? []) as Array<{ value: string }>).flatMap((row) => row.value.match(/Mã \d+/gu) ?? []))].slice(0, 60);
  const counts = new Map<string, number>();
  for (const row of (owners ?? []) as Array<{ human_user_id: string; total: number }>) counts.set(row.human_user_id, Number(row.total) || 0);
  const people = ((links ?? []) as Array<{ human_user_id: string; human_name: string | null; profile_id: string | null }>).map((link) => ({ humanId: link.human_user_id, humanName: link.human_name, profileId: link.profile_id, customers: counts.get(link.human_user_id) ?? 0 }))
    .sort((a, b) => b.customers - a.customers);
  const card = "rounded-xl border border-slate-200 bg-white p-5";
  return <div className="max-w-5xl space-y-5">
    <div><Link href="/customers" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4"/>Khách hàng</Link><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Cài đặt Khách hàng</h1></div>

    <section className={card}>
      <h2 className="font-bold text-slate-900">Kết nối Human</h2>
      <p className="mt-1 text-sm text-slate-600">Dùng chung token với màn Tài liệu. Token hết hạn thì dán token mới; dữ liệu cũ vẫn giữ. Tự cập nhật mỗi 6 giờ.</p>
      <div className="mt-3"><HumanApiSettings/></div>
    </section>

    <section className={card}>
      <h2 className="font-bold text-slate-900">Khối dữ liệu</h2>
      <p className="mt-1 text-sm text-slate-600">Mỗi khối là một danh sách khách trên Human (blockId). Tắt khối thì lần cập nhật sau khách của khối đó sẽ ẩn.</p>
      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200"><table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Mã</th><th className="px-3 py-2">Tên hiển thị</th><th className="px-3 py-2">Bật</th><th className="px-3 py-2">Lần cập nhật</th><th className="px-3 py-2"/></tr></thead>
        <tbody>{((blocks ?? []) as Array<{ block_id: number; name: string | null; enabled: boolean; last_synced_at: string | null; last_count: number | null; last_error: string | null }>).map((block) => <tr key={block.block_id} className="border-t border-slate-100">
          <td className="px-3 py-2 font-mono text-slate-700">{block.block_id}</td>
          <td className="px-3 py-2" colSpan={2}><form action={updateCustomerBlock} className="flex items-center gap-3"><input type="hidden" name="blockId" value={block.block_id}/>
            <input name="name" defaultValue={block.name ?? ""} placeholder={`Khối ${block.block_id}`} maxLength={80} className="h-8 w-56 rounded-lg border border-slate-200 px-2 text-sm"/>
            <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" name="enabled" defaultChecked={block.enabled}/>Bật</label>
            <button className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Lưu</button>
            <button name="intent" value="remove" className="h-8 rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50">Xoá</button></form></td>
          <td className="px-3 py-2 text-xs text-slate-600">{block.last_synced_at ? `${time(block.last_synced_at)} · ${block.last_count ?? 0} khách` : "Chưa cập nhật"}{block.last_error ? <span className="block text-rose-600">Lỗi: {ERRORS[block.last_error] ?? block.last_error}</span> : null}</td>
          <td/>
        </tr>)}</tbody>
      </table></div>
      <div className="mt-4"><AddBlockForm/></div>
    </section>

    <section className={card}>
      <h2 className="font-bold text-slate-900">Sale / AM trên Human là ai ở HireX</h2>
      <p className="mt-1 text-sm text-slate-600">Người không có quyền &quot;Xem tất cả khách&quot; chỉ thấy khách mà họ là Sale hoặc AM, theo liên kết này.</p>
      <div className="mt-3"><UserLinksForm people={people} members={((members ?? []) as Array<{ id: string; full_name: string | null }>).map((member) => ({ id: member.id, name: member.full_name ?? "?" }))}/></div>
    </section>

    <section className={card}>
      <h2 className="font-bold text-slate-900">Soda ghim Tình trạng CV vào nhóm Zalo</h2>
      <p className="mt-1 text-sm text-slate-600">Mỗi ngày đúng giờ, {nick ? <b>{nick.name}</b> : "nick Soda"} gửi Tình trạng CV của công ty vào các nhóm đã duyệt bên dưới (đúng mẫu tin AM đang ghim, tin dài thì gửi nhiều phần) và ghim phần đầu. Chỉ nhóm có thay đổi so với lần ghim trước; gửi trong 8:00–21:00, cách nhau 30–60 giây. Người bật lịch là người duyệt các tin này.</p>
      {!nick ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Chưa cài nick Soda (Trợ lý Zalo) nên chưa ghim được.</p> : !nick.connected ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Nick {nick.name} đang mất kết nối.</p> : null}
      <div className="mt-3"><CvPinSettingsForm enabled={pinSettings?.enabled === true} time={pinTime}/></div>
      {pinSettings?.last_run_at ? <p className="mt-2 text-xs text-slate-500">Lần chạy gần nhất {time(pinSettings.last_run_at)}: {pinSettings.last_result} · <Link href="/broadcasts" className="font-semibold text-blue-700 hover:underline">xem ở Gửi nhóm Zalo</Link></p> : null}
      <div className="mt-3"><CvPinRunButtons/></div>

      <h3 className="mt-5 text-sm font-bold text-slate-900">Nhóm của Soda ↔ công ty <span className="font-normal text-slate-500">· {confirmedCount}/{groupRows.length} nhóm đã duyệt</span></h3>
      <p className="mt-0.5 text-xs text-slate-500">HireX gợi ý theo tên nhóm; bấm Đúng để duyệt, hoặc gõ tên công ty khác rồi bấm Ghép. Sale/AM của công ty cũng duyệt được ở màn Khách hàng.</p>
      <datalist id="partner-options">{[...partnerName].map(([id, name]) => <option key={id} value={`${name} #${id}`}/>)}</datalist>
      <div className="mt-2 max-h-[560px] overflow-y-auto rounded-lg border border-slate-200"><table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Nhóm Zalo</th><th className="px-3 py-2">Công ty</th></tr></thead>
        <tbody>{groupRows.map((group) => <tr key={group.groupId} className="border-t border-slate-100 align-top">
          <td className="max-w-[280px] px-3 py-2"><span className="block truncate font-medium text-slate-800" title={group.name}>{group.name}</span></td>
          <td className="px-3 py-2"><div className="space-y-1.5">
            {group.links.map((link) => <form key={link.partnerId} action={decidePartnerGroup} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="groupId" value={group.groupId}/><input type="hidden" name="partnerId" value={link.partnerId}/><input type="hidden" name="groupName" value={group.name}/>
              <Link href={`/customers?id=${link.partnerId}`} className="font-semibold text-slate-900 hover:underline">{partnerName.get(link.partnerId) ?? `Khách #${link.partnerId}`}</Link>
              {link.status === "CONFIRMED" ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Đã duyệt</span> : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Gợi ý</span>}
              {link.status !== "CONFIRMED" ? <button name="decision" value="CONFIRMED" className="h-7 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white">Đúng</button> : null}
              <button name="decision" value="REJECTED" className="h-7 rounded-md px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50">{link.status === "CONFIRMED" ? "Bỏ ghép" : "Không phải"}</button>
            </form>)}
            {!group.links.some((link) => link.status === "CONFIRMED") ? <form action={decidePartnerGroup} className="flex items-center gap-1.5">
              <input type="hidden" name="groupId" value={group.groupId}/><input type="hidden" name="groupName" value={group.name}/><input type="hidden" name="decision" value="CONFIRMED"/>
              <input name="partnerPick" list="partner-options" placeholder="Gõ tên công ty…" className="h-7 w-56 rounded-md border border-slate-200 px-2 text-xs"/>
              <button className="h-7 rounded-md border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Ghép</button>
            </form> : null}
          </div></td>
        </tr>)}
        {!groupRows.length ? <tr><td colSpan={2} className="px-3 py-4 text-center text-xs text-slate-500">Nick Soda chưa có nhóm Zalo nào trong HireX.</td></tr> : null}</tbody>
      </table></div>
    </section>

    <section className={card}>
      <h2 className="font-bold text-slate-900">Bộ mã Human</h2>
      <p className="mt-1 text-sm text-slate-600">Đổi mã (MasterId) thành tên: xếp hạng công việc, xếp hạng AM, địa điểm… Đang có {(codeCount ?? 0).toLocaleString("vi-VN")} mã.</p>
      {unknown.length ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Mã chưa có tên trong dữ liệu: {unknown.map((code) => code.replace("Mã ", "")).join(", ")}</p> : null}
      <div className="mt-3"><ImportCodesForm/></div>
    </section>

    <section className={card}>
      <h2 className="font-bold text-slate-900">Lịch sử cập nhật</h2>
      <ul className="mt-2 divide-y divide-slate-100 text-sm">{((syncs ?? []) as Array<{ id: string; trigger: string; started_at: string; finished_at: string | null; ok: boolean | null; rows: number | null; error: string | null }>).map((sync) =>
        <li key={sync.id} className="flex flex-wrap gap-x-3 py-1.5"><span className="text-slate-700">{time(sync.started_at)}</span><span className="text-slate-500">{sync.trigger === "MANUAL" ? "Bấm tay" : "Tự động"}</span>
          <span className={sync.ok ? "text-emerald-700" : sync.ok === false ? "text-rose-600" : "text-slate-500"}>{sync.ok ? `${sync.rows ?? 0} khách` : sync.ok === false ? `Lỗi: ${ERRORS[sync.error ?? ""] ?? sync.error ?? "?"}` : "Đang chạy…"}</span></li>)}
        {!(syncs ?? []).length ? <li className="py-1.5 text-slate-500">Chưa cập nhật lần nào.</li> : null}</ul>
    </section>
  </div>;
}
