"use client";

// Popover chọn phạm vi xem (#top › Phạm vi): Toàn hệ thống / Bộ phận / cây owner, ô tìm, công tắc "Gồm cấp dưới".
// Port của scopeList/scopePop + ACT.scope/sx/subtog trong v7.py. App mở bằng openPop(anchor, <ScopeMenu />, "scpm").
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Id } from "../types";
import { scopeCalc, treeOrder, type OwnerX } from "../core/model";
import { nz } from "../core/text";
import { IC, Ico } from "./icons";
import { I, S, emit, savePref, setScope, store, useHs } from "./store";
import { closePop } from "./ui-kit";
import { openSettings } from "./settings";

interface Row { d: Id | "all"; o: Id | null; dp: number; hasK: boolean; key: string; on: boolean; dot: string; name: string; n: number }

/** mở/đóng nhánh cây phạm vi · bật/tắt "gồm cấp dưới" */
function scopeTog(key: string) { S.exp[key] = S.exp[key] === false; savePref(); emit(); }
function scopeSubTog() { S.sub = !S.sub; scopeCalc(S, I); savePref(); emit(); }
export function ScopeMenu() {
  useHs();
  const [q, setQ] = useState("");
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { inp.current?.focus(); }, []);
  const s = nz(q), cnt = (o: OwnerX) => (S.sub ? I.sub[o.id] || 0 : I.ownN[o.id] || 0);
  const rows: Row[] = [];
  if (!s) rows.push({ d: "all", o: null, dp: 0, hasK: false, key: "a", on: S.dept === "all" && S.owner == null, dot: "#667085", name: "Toàn hệ thống", n: S.accs.length });
  for (const d of S.meta.depts) {
    if (s) {
      for (const { o } of treeOrder(I, d.id)) if (nz(o.name).includes(s) || nz(d.name).includes(s)) rows.push({ d: d.id, o: o.id, dp: 1, hasK: false, key: "", on: S.owner === o.id, dot: o.color, name: o.name + "  ·  " + d.name, n: cnt(o) });
      continue;
    }
    rows.push({ d: d.id, o: null, dp: 0, hasK: (I.roots[d.id] || []).length > 0, key: "d" + d.id, on: S.dept === d.id && S.owner == null, dot: d.color, name: d.name, n: I.deptN[d.id] || 0 });
    if (S.exp["d" + d.id] === false) continue;
    const seen = new Set<Id>();
    const walk = (id: Id, dp: number) => {
      const o = I.own[id]; if (!o || seen.has(id)) return; seen.add(id);
      const ks = I.kids[id] || [];
      rows.push({ d: d.id, o: o.id, dp, hasK: ks.length > 0, key: "o" + id, on: S.owner === o.id, dot: o.color, name: o.name, n: cnt(o) });
      if (S.exp["o" + id] !== false) for (const k of ks) walk(k, dp + 1);
    };
    for (const r of I.roots[d.id] || []) walk(r, 1);
  }
  const pick = (r: Row) => setScope(r.d, r.o);
  const tog = scopeTog;
  const subtog = scopeSubTog;
  let list: ReactNode;
  if (!rows.length) list = <div className="ph pad"><Ico n="inbox" sz={20} /></div>;
  else list = rows.map((r) => <div key={r.d + ":" + (r.o ?? "")} className={`tn ${r.o ? "o" : ""} ${r.on ? "on" : ""}`} style={{ "--d": r.dp } as CSSProperties} role="button" tabIndex={-1} onClick={() => pick(r)}>
    <button className={`tg ${r.hasK && !s ? "" : "x"}`} tabIndex={-1} onClick={(e) => { e.stopPropagation(); if (r.key) tog(r.key); }}><Ico n={S.exp[r.key] === false ? "chevr" : "chevd"} sz={12} /></button>
    <i className="dot" style={{ background: r.dot }} /><span className="t">{r.name}</span><em>{r.n}</em></div>);
  return <div className="scpop">
    <div className="psearch"><Ico n="search" sz={14} /><input ref={inp} className="in" placeholder="Tìm bộ phận hoặc owner" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && rows.length) { e.preventDefault(); pick(rows[0]); } }} /></div>
    <div className="scl">{list}</div>
    <div className="scfoot"><Ico n={"sub" in IC ? "sub" : "users"} sz={15} /><span className="grow">Gồm cấp dưới</span>
      <button type="button" className={`sw ${S.sub ? "on" : ""}`} aria-pressed={S.sub} title="Gồm cấp dưới" onClick={subtog} />
      {store.canManage ? <button className="btn icon sm ghost" title="Quản lý owner" onClick={() => { closePop(); openSettings("owner"); }}><Ico n="gear" sz={15} /></button> : null}
    </div>
  </div>;
}
