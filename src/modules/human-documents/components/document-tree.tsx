"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, FileText, Folder } from "lucide-react";
import { buildDocumentTree, documentFolderPath, type DocumentFolder, type TreeEntry } from "../core/hierarchy";

export function DocumentTree({ compact, selectedId, query, folderPaths }: { compact: { paths: string[][]; docs: Array<[number, string, number]> }; selectedId?: number; query: string; folderPaths?: string[][] }) {
  const documents = useMemo<TreeEntry[]>(() => compact.docs.map(([id, name, at]) => ({ id, name, group: compact.paths[at]?.at(-1) ?? "", folderPath: compact.paths[at] })), [compact]);
  const tree = useMemo(() => buildDocumentTree(documents, folderPaths), [documents, folderPaths]);
  const selected = documents.find(doc => doc.id === selectedId);
  const selectedPath = selected ? selected.folderPath ?? documentFolderPath(selected.group) : [];
  const [opened, setOpened] = useState<Set<string>>(() => new Set(selectedPath.map((_, index) => JSON.stringify(selectedPath.slice(0, index + 1)))));
  const [limits, setLimits] = useState<Record<string, number>>({});
  function toggle(key: string) { setOpened(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }
  function folder(node: DocumentFolder, depth: number) {
    const expanded = opened.has(node.key);
    const limit = Math.max(limits[node.key] ?? 40, node.documents.findIndex(doc => doc.id === selectedId) + 1);
    return <li key={node.key}>
      <button type="button" aria-expanded={expanded} onClick={() => toggle(node.key)} className="flex min-w-max items-center gap-1 rounded px-1 py-1.5 text-left text-xs hover:bg-indigo-50"><ChevronRight size={12} className={`shrink-0 ${expanded ? "rotate-90" : ""}`}/><Folder size={14} className={`shrink-0 ${["text-rose-500", "text-orange-400", "text-yellow-500", "text-sky-500"][Math.min(depth, 3)]}`}/><span className={depth < 2 ? "font-medium" : ""}>{node.name}</span></button>
      {expanded && <ul className="ml-3 border-l border-dotted border-slate-300 pl-1">
        {node.documents.slice(0, limit).map(doc => <li key={doc.id}><Link prefetch={false} href={`/documents?${new URLSearchParams({ q: query, id: String(doc.id) })}`} aria-current={doc.id === selectedId ? "page" : undefined} className={`flex min-w-max items-center gap-1 rounded px-2 py-1 text-xs ${doc.id === selectedId ? "bg-indigo-100 font-medium text-indigo-800" : "text-slate-700 hover:bg-white"}`}><FileText size={12} className="shrink-0 text-slate-400"/>{doc.name}</Link></li>)}
        {node.documents.length > limit && <li><button type="button" onClick={() => setLimits(previous => ({ ...previous, [node.key]: limit + 40 }))} className="p-2 text-xs text-indigo-600">Xem thêm tài liệu ({node.documents.length - limit})</button></li>}
        {node.children.map(child => folder(child, depth + 1))}
      </ul>}
    </li>;
  }
  return <nav aria-label="Cây thư mục tài liệu" className="min-w-0 border-b bg-slate-50/70 lg:border-b-0 lg:border-r">
    <div className="flex items-center justify-between border-b p-3 text-xs text-slate-500"><span>{documents.length.toLocaleString("vi-VN")} tài liệu</span><button type="button" onClick={() => setOpened(new Set())} className="text-indigo-600">Thu gọn</button></div>
    <div className="max-h-[72vh] overflow-auto p-2"><ul>{tree.map(node => folder(node, 0))}</ul>{!documents.length && <p className="p-4 text-sm text-slate-500">Không có tài liệu phù hợp.</p>}</div>
    <p className="border-t p-3 text-[10px] leading-4 text-slate-400">{folderPaths ? "Cấu trúc thư mục được đồng bộ từ Human theo ID và thư mục cha." : "Bản dữ liệu cũ: cập nhật từ Human để tải đầy đủ cấu trúc thư mục."}</p>
  </nav>;
}
