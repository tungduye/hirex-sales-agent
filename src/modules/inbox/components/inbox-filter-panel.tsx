"use client";

import { ChevronDown, ChevronRight, Search, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChannelLogo } from "@/modules/channels/components/channel-logo";
import { accountsInGroups, buildTree, compactSelection, type TreeDepartment } from "../core/account-tree";
import type { OmnichannelInboxAccount } from "../types/omnichannel-inbox";

const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().replace(/\s+/gu, " ").trim();

/**
 * Bộ lọc người (the people icon next to the search box): nicks as a tree Bộ phận → Thị trường → Owner → nick.
 * Ticking a branch ticks everything under it; the search finds any level and keeps the path. "Áp dụng" sends whole
 * branches as groups (?grp=) and single nicks as ?account=, so a nick added later to a picked branch is included.
 */
export function InboxFilterPanel(props: {
  accounts: OmnichannelInboxAccount[];
  owners: Array<{ id: string; fullName: string; accountCount: number }>;
  view: string;
  search: string;
  channel: string | null;
  selectedAccountIds: string[];
  selectedGroups: string[];
  selectedOwnerIds: string[];
  selectedTagIds: string[];
  tagMatchMode: "all" | "any";
  firstMessageFrom: string | null;
  firstMessageTo: string | null;
  unreadOnly?: boolean;
  clearHref: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = props.selectedAccountIds.length + props.selectedGroups.length + props.selectedOwnerIds.length + (props.firstMessageFrom || props.firstMessageTo ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onClick = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);

  return <div ref={rootRef} className="shrink-0">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Lọc theo bộ phận, thị trường, người, nick" title="Lọc theo bộ phận, thị trường, người, nick"
      className={`relative flex size-9 items-center justify-center rounded-lg border ${active || open ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
      <Users className="size-4"/>{active ? <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">{active}</span> : null}
    </button>
    {open ? <PeoplePanel {...props} onClose={() => setOpen(false)}/> : null}
  </div>;
}

function PeoplePanel(props: Parameters<typeof InboxFilterPanel>[0] & { onClose: () => void }) {
  const tree = useMemo(() => buildTree(props.accounts.map((account) => ({ id: account.id, displayName: account.displayName, ownerId: account.primaryProfileId ?? null,
    ownerName: account.primaryName ?? null, department: account.ownerDepartment ?? null, market: account.market ?? null }))), [props.accounts]);
  const accountById = useMemo(() => new Map(props.accounts.map((account) => [account.id, account])), [props.accounts]);
  // What is picked now: nicks, branches and (older links) owners, all as nicks.
  const [picked, setPicked] = useState(() => {
    const flat = tree.flatMap((dept) => dept.markets.flatMap((market) => market.owners.flatMap((owner) => owner.accounts)));
    return new Set([...props.selectedAccountIds, ...accountsInGroups(flat, props.selectedGroups),
      ...flat.filter((account) => account.ownerId && props.selectedOwnerIds.includes(account.ownerId)).map((account) => account.id)]);
  });
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set(tree.length === 1 ? [`d:${tree[0].key}`] : []));
  const [query, setQuery] = useState("");
  const [unread, setUnread] = useState<Record<string, { people: number }>>({});
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/inbox/account-unread", { signal: controller.signal }).then((response) => response.ok ? response.json() as Promise<Record<string, { people: number }>> : {})
      .then((value) => setUnread(value)).catch(() => undefined);
    return () => controller.abort();
  }, []);

  // Search: a branch whose name matches shows whole; otherwise only the nicks that match, with their path.
  const needle = fold(query);
  const shown: TreeDepartment[] = useMemo(() => {
    if (!needle) return tree;
    const hit = (text: string) => fold(text).includes(needle);
    return tree.flatMap((dept) => {
      if (hit(dept.label)) return [dept];
      const markets = dept.markets.flatMap((market) => {
        if (hit(market.label)) return [market];
        const owners = market.owners.flatMap((owner) => {
          if (hit(owner.label)) return [owner];
          const accounts = owner.accounts.filter((account) => hit(account.displayName));
          return accounts.length ? [{ ...owner, accounts }] : [];
        });
        return owners.length ? [{ ...market, owners }] : [];
      });
      return markets.length ? [{ ...dept, markets }] : [];
    });
  }, [needle, tree]);
  const isOpen = (key: string) => Boolean(needle) || openKeys.has(key);
  const flip = (key: string) => setOpenKeys((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const toggle = (ids: string[], on: boolean) => setPicked((current) => { const next = new Set(current); for (const id of ids) { if (on) next.add(id); else next.delete(id); } return next; });
  const compact = compactSelection(tree, picked);

  const row = (key: string, depth: number, label: string, ids: string[], meta: string, children: boolean) => {
    const count = ids.filter((id) => picked.has(id)).length;
    const unreadSum = ids.reduce((sum, id) => sum + (unread[id]?.people ?? 0), 0);
    return <div className={`flex items-center gap-1.5 border-b border-slate-50 py-1.5 pr-2 hover:bg-slate-50 ${depth === 0 ? "bg-slate-50/80" : ""}`} style={{ paddingLeft: 6 + depth * 14 }}>
      {children ? <button type="button" onClick={() => flip(key)} aria-label={isOpen(key) ? `Thu gọn ${label}` : `Mở ${label}`} className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">{isOpen(key) ? <ChevronDown className="size-3.5"/> : <ChevronRight className="size-3.5"/>}</button> : <span className="w-[18px]"/>}
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={count === ids.length && ids.length > 0} ref={(element) => { if (element) element.indeterminate = count > 0 && count < ids.length; }} onChange={(event) => toggle(ids, event.target.checked)} className="size-3.5 shrink-0 accent-blue-600"/>
        <span className={`min-w-0 flex-1 truncate text-[13px] ${depth === 0 ? "font-bold text-slate-800" : depth === 1 ? "font-semibold text-slate-700" : depth === 2 ? "font-medium text-slate-700" : "text-slate-800"}`}>{label}</span>
      </label>
      {unreadSum ? <span className="shrink-0 rounded-full bg-blue-600 px-1.5 text-[10px] font-bold leading-4 text-white" title={`${unreadSum} hội thoại chưa đọc`}>{unreadSum > 99 ? "99+" : unreadSum}</span> : null}
      <span className="shrink-0 text-[11px] text-slate-400">{meta}</span>
    </div>;
  };

  return <div className="absolute inset-x-2 top-[52px] z-40 flex max-h-[calc(100dvh-14rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" role="dialog" aria-label="Lọc theo người">
    <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2.5"><p className="text-sm font-bold text-slate-900">Lọc theo người {picked.size ? <span className="font-semibold text-blue-700">· {picked.size} nick</span> : null}</p><button type="button" onClick={props.onClose} aria-label="Đóng" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4"/></button></div>
    <div className="shrink-0 px-3 pt-2.5">
      <label className="relative block"><Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-slate-400"/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm bộ phận, thị trường, người, nick…" aria-label="Tìm trong bộ lọc người" className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-7 text-xs outline-none focus:border-blue-400 focus:bg-white"/>{query ? <button type="button" onClick={() => setQuery("")} aria-label="Xóa tìm kiếm" className="absolute right-1 top-1 rounded p-1 text-slate-400 hover:text-slate-700"><X className="size-3.5"/></button> : null}</label>
    </div>
    <div className="mx-3 my-2 min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-100">
      {shown.map((dept) => {
        const deptIds = dept.markets.flatMap((market) => market.owners.flatMap((owner) => owner.accounts.map((account) => account.id)));
        return <div key={dept.key}>
          {row(`d:${dept.key}`, 0, dept.label, deptIds, `${deptIds.length} nick`, true)}
          {isOpen(`d:${dept.key}`) ? dept.markets.map((market) => {
            const marketKey = `m:${dept.key}|${market.key}`;
            const marketIds = market.owners.flatMap((owner) => owner.accounts.map((account) => account.id));
            return <div key={marketKey}>
              {row(marketKey, 1, market.label, marketIds, String(marketIds.length), true)}
              {isOpen(marketKey) ? market.owners.map((owner) => {
                const ownerKey = `o:${dept.key}|${market.key}|${owner.key}`;
                return <div key={ownerKey}>
                  {row(ownerKey, 2, owner.label, owner.accounts.map((account) => account.id), String(owner.accounts.length), true)}
                  {isOpen(ownerKey) ? owner.accounts.map((account) => { const channel = accountById.get(account.id)?.channelType; return <div key={account.id} className="flex items-center">
                    {row(account.id, 3, account.displayName, [account.id], "", false)}
                    {channel ? <span className="-ml-1 mr-2 shrink-0"><ChannelLogo channel={channel} size={13}/></span> : null}
                  </div>; }) : null}
                </div>;
              }) : null}
            </div>;
          }) : null}
        </div>;
      })}
      {!shown.length ? <p className="px-3 py-4 text-center text-xs text-slate-500">Không tìm thấy.</p> : null}
    </div>
    <form action="/inbox/all" className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5">
      {props.channel ? <input type="hidden" name="channel" value={props.channel}/> : null}
      {props.firstMessageFrom ? <input type="hidden" name="firstFrom" value={props.firstMessageFrom}/> : null}
      {props.firstMessageTo ? <input type="hidden" name="firstTo" value={props.firstMessageTo}/> : null}
      {props.view && props.view !== "all" ? <input type="hidden" name="view" value={props.view}/> : null}
      {props.search ? <input type="hidden" name="q" value={props.search}/> : null}
      {props.selectedTagIds.map((id) => <input key={id} type="hidden" name="tag" value={id}/>)}
      {props.selectedTagIds.length ? <input type="hidden" name="tagMode" value={props.tagMatchMode}/> : null}
      {props.unreadOnly ? <input type="hidden" name="unread" value="1"/> : null}
      {compact.groups.map((group) => <input key={group} type="hidden" name="grp" value={group}/>)}
      {compact.accounts.length ? <input type="hidden" name="account" value={compact.accounts.join(",")}/> : null}
      {picked.size ? <button type="button" onClick={() => setPicked(new Set())} className="text-xs font-semibold text-slate-500 hover:text-rose-600">Bỏ chọn</button> : active(props) ? <a href={props.clearHref} className="text-xs font-semibold text-slate-500 hover:text-rose-600">Xóa lọc</a> : <span className="text-xs text-slate-400">Chưa lọc gì</span>}
      <button className="h-8 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700">Áp dụng</button>
    </form>
  </div>;
}

const active = (props: { selectedAccountIds: string[]; selectedGroups: string[]; selectedOwnerIds: string[] }) => props.selectedAccountIds.length + props.selectedGroups.length + props.selectedOwnerIds.length > 0;
