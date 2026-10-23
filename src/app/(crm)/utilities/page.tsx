import { bootData } from "../../../../moduleHS/record/api";
import { UtilitiesApp } from "../../../../moduleHS/record/utilities";

export const metadata = { title: "Tiện ích" };
export const dynamic = "force-dynamic";

/** Tiện ích: Cuộc họp (moduleHS/record) · Kiểm thử phần mềm. Mọi thành viên đã đăng nhập. */
export default function UtilitiesPage() {
  return <div className="h-[calc(100dvh-4rem)] min-h-0 overflow-hidden bg-white lg:h-dvh"><UtilitiesApp boot={bootData()} /></div>;
}
