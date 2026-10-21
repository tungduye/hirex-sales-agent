import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { HumanApiSettings } from "@/modules/human-documents/components/api-controls";
import { AddCvBlockForm, RecLinksForm } from "@/modules/cvs/components/cv-forms";
import { updateCvBlock } from "@/modules/cvs/server/cv-actions";
import { cvContext } from "@/modules/cvs/server/cv-data";

const time = (value: string | null) => value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—";
const ERRORS: Record<string, string> = { NO_TOKEN: "Chưa có token Human", NO_BLOCKS: "Chưa bật khối nào", HUMAN_TOKEN_EXPIRED: "Token Human hết hạn", SAVE_FAILED: "Lỗi lưu dữ liệu", RESPONSE_TOO_LARGE: "Dữ liệu trả về quá lớn", INVALID_RESPONSE: "Human trả dữ liệu lạ" };

export default async function CvSettingsPage() {
  const context = await cvContext();
  if (!context?.canManage) redirect("/cvs");
  const db = await createClient();
  const [{ data: blocks }, { data: links }, { data: members }, { data: syncs }, { data: facets }] = await Promise.all([
    db.from("human_cv_blocks").select("block_key,name,enabled,last_synced_at,last_count,last_error").eq("workspace_id", context.workspaceId).order("sort").order("block_key"),
    db.from("human_user_links").select("human_user_id,human_name,profile_id").eq("workspace_id", context.workspaceId).order("human_name"),
    db.from("profiles").select("id,full_name").eq("workspace_id", context.workspaceId).order("full_name"),
    db.from("human_cv_syncs").select("id,trigger,started_at,finished_at,ok,rows,error").eq("workspace_id", context.workspaceId).order("started_at", { ascending: false }).limit(10),
    db.rpc("human_cv_facets"),
  ]);
  const counts = new Map(((facets ?? []) as Array<{ kind: string; value: string; total: number }>).filter((row) => row.kind === "recer" && row.value).map((row) => [row.value, Number(row.total) || 0]));
  const people = ((links ?? []) as Array<{ human_user_id: string; human_name: string | null; profile_id: string | null }>).filter((link) => counts.has(link.human_user_id))
    .map((link) => ({ humanId: link.human_user_id, humanName: link.human_name, profileId: link.profile_id, cvs: counts.get(link.human_user_id) ?? 0 })).sort((a, b) => b.cvs - a.cvs);
  const card = "rounded-xl border border-slate-200 bg-white p-5";
  return <div className="max-w-5xl space-y-5">
    <div><Link href="/cvs" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4"/>CV</Link><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Cài đặt CV</h1></div>

    <section className={card}>
      <h2 className="font-bold text-slate-900">Kết nối Human</h2>
      <p className="mt-1 text-sm text-slate-600">Dùng chung token với màn Tài liệu và Khách hàng. Tự cập nhật mỗi 6 giờ.</p>
      <div className="mt-3"><HumanApiSettings/></div>
    </section>

    <section className={card}>
      <h2 className="font-bold text-slate-900">Khối CV</h2>
      <p className="mt-1 text-sm text-slate-600">Mỗi khối là một danh sách CV trên Human (blockId, ví dụ CV_GOC). Tắt khối thì lần cập nhật sau CV của khối đó sẽ ẩn.</p>
      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200"><table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Mã</th><th className="px-3 py-2">Tên hiển thị · Bật</th><th className="px-3 py-2">Lần cập nhật</th></tr></thead>
        <tbody>{((blocks ?? []) as Array<{ block_key: string; name: string | null; enabled: boolean; last_synced_at: string | null; last_count: number | null; last_error: string | null }>).map((block) => <tr key={block.block_key} className="border-t border-slate-100">
          <td className="px-3 py-2 font-mono text-slate-700">{block.block_key}</td>
          <td className="px-3 py-2"><form action={updateCvBlock} className="flex flex-wrap items-center gap-3"><input type="hidden" name="blockKey" value={block.block_key}/>
            <input name="name" defaultValue={block.name ?? ""} placeholder={block.block_key} maxLength={80} className="h-8 w-56 rounded-lg border border-slate-200 px-2 text-sm"/>
            <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" name="enabled" defaultChecked={block.enabled}/>Bật</label>
            <button className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Lưu</button>
            <button name="intent" value="remove" className="h-8 rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50">Xoá</button></form></td>
          <td className="px-3 py-2 text-xs text-slate-600">{block.last_synced_at ? `${time(block.last_synced_at)} · ${(block.last_count ?? 0).toLocaleString("vi-VN")} CV` : "Chưa cập nhật"}{block.last_error ? <span className="block text-rose-600">Lỗi: {ERRORS[block.last_error] ?? block.last_error}</span> : null}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="mt-4"><AddCvBlockForm/></div>
    </section>

    <section className={card}>
      <h2 className="font-bold text-slate-900">Rec trên Human là ai ở HireX</h2>
      <p className="mt-1 text-sm text-slate-600">Rec thấy CV mình phụ trách; người có quyền &quot;Xem tất cả CV&quot; thấy hết. Liên kết này dùng chung với Sale/AM ở Khách hàng.</p>
      <div className="mt-3"><RecLinksForm people={people} members={((members ?? []) as Array<{ id: string; full_name: string | null }>).map((member) => ({ id: member.id, name: member.full_name ?? "?" }))}/></div>
    </section>

    <section className={card}>
      <h2 className="font-bold text-slate-900">Lịch sử cập nhật</h2>
      <ul className="mt-2 divide-y divide-slate-100 text-sm">{((syncs ?? []) as Array<{ id: string; trigger: string; started_at: string; finished_at: string | null; ok: boolean | null; rows: number | null; error: string | null }>).map((sync) =>
        <li key={sync.id} className="flex flex-wrap gap-x-3 py-1.5"><span className="text-slate-700">{time(sync.started_at)}</span><span className="text-slate-500">{sync.trigger === "MANUAL" ? "Bấm tay" : "Tự động"}</span>
          <span className={sync.ok ? "text-emerald-700" : sync.ok === false ? "text-rose-600" : "text-slate-500"}>{sync.ok ? `${(sync.rows ?? 0).toLocaleString("vi-VN")} CV` : sync.ok === false ? `Lỗi: ${ERRORS[sync.error ?? ""] ?? sync.error ?? "?"}` : "Đang chạy…"}</span></li>)}
        {!(syncs ?? []).length ? <li className="py-1.5 text-slate-500">Chưa cập nhật lần nào.</li> : null}</ul>
    </section>
  </div>;
}
