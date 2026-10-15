import { Suspense, type ReactNode } from "react";
import { InboxShell } from "@/modules/inbox/components/inbox-shell";

export default function InboxAllLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}><InboxShell>{children}</InboxShell></Suspense>;
}
