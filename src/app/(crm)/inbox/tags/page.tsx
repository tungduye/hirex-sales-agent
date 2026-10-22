import Link from "next/link";
import { ArrowLeft, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { requirePermission } from "@/modules/access/server/access-control";
import { saveTagGroups } from "@/modules/inbox/server/tag-groups";

export const metadata = { title: "Nhãn & nhóm thẻ" };

const SUGGESTED = ["Thị trường", "Vị trí", "Loại liên hệ"];

/** Every Suối Nguồn tag with its nhóm thẻ, so Soda can answer "thị trường IT Nhật", "thẻ BrSE"… */
export default async function TagGroupsPage() {
  const account = await requirePermission("inbox.update");
  const { data } = await createPrivilegedClient().from("conversation_tags").select("id,name,color,group_name").eq("workspace_id", account.workspaceId).order("name");
  const tags = (data ?? []).map((row) => ({ id: String(row.id), name: String(row.name), color: typeof row.color === "string" ? row.color : null, group: typeof row.group_name === "string" ? row.group_name : "" }));
  const groups = [...new Set([...SUGGESTED, ...tags.map((tag) => tag.group).filter(Boolean)])];
  const byGroup = new Map<string, typeof tags>();
  for (const tag of tags) byGroup.set(tag.group, [...(byGroup.get(tag.group) ?? []), tag]);
  const ordered = [...[...byGroup.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, "vi")), ...(byGroup.has("") ? [""] : [])];
  return <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><Link href="/inbox/all" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-blue-700"><ArrowLeft className="size-4"/>Suối Nguồn</Link>
        <h1 className="mt-1 flex items-center gap-2 text-xl font-bold text-slate-950"><Tags className="size-5"/>Nhãn &amp; nhóm thẻ</h1>
        <p className="mt-1 text-sm text-slate-500">Xếp mỗi nhãn vào một nhóm (Thị trường, Vị trí, Loại liên hệ…) để hỏi Soda như “bao nhiêu đầu mối khách hàng thị trường IT Nhật”. Để trống nếu nhãn không thuộc nhóm nào.</p></div>
    </div>
    {tags.length === 0 ? <p className="rounded-xl border bg-white p-6 text-sm text-slate-500">Chưa có nhãn nào. Tạo nhãn trong bộ lọc Nhãn của Suối Nguồn.</p> :
    <form action={saveTagGroups} className="space-y-4">
      <datalist id="tag-groups">{groups.map((group) => <option key={group} value={group}/>)}</datalist>
      {ordered.map((group) => <section key={group || "none"} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700">{group || "Chưa xếp nhóm"} <span className="font-normal text-slate-400">· {byGroup.get(group)?.length ?? 0} nhãn</span></h2>
        <div className="divide-y divide-slate-100">{(byGroup.get(group) ?? []).map((tag) => <label key={tag.id} className="flex items-center gap-3 px-4 py-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color ?? "#64748b" }}/>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{tag.name}</span>
          <input type="hidden" name={`before:${tag.id}`} value={tag.group}/>
          <input name={`group:${tag.id}`} defaultValue={tag.group} list="tag-groups" maxLength={60} placeholder="Nhóm thẻ" aria-label={`Nhóm thẻ của ${tag.name}`} className="h-9 w-48 rounded-lg border border-slate-300 px-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/>
        </label>)}</div>
      </section>)}
      <div className="sticky bottom-4 flex justify-end"><Button type="submit">Lưu nhóm thẻ</Button></div>
    </form>}
  </div>;
}
