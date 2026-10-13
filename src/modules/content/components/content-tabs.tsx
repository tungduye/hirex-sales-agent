import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/content", label: "Content đã tạo" },
  { href: "/content/templates", label: "Kho mẫu" },
] as const;

export function ContentTabs({ active }: { active: "/content" | "/content/templates" }) {
  return (
    <nav className="mb-5 flex gap-1 border-b" aria-label="Kho content">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={tab.href === active ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors", tab.href === active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
