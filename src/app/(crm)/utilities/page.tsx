import { bootData } from "../../../../moduleHS/record/api";
import { UtilitiesApp } from "../../../../moduleHS/record/utilities";

export const metadata = { title: "Tiện ích" };
export const dynamic = "force-dynamic";

/** Tiện ích: Cuộc họp (moduleHS/record) · Kiểm thử phần mềm. Mọi thành viên đã đăng nhập. */
export default function UtilitiesPage() {
  // Chiều cao viết thẳng (không dùng class Tailwind mới: Cloudflare giữ file CSS cũ 4 giờ). Máy lớn không có thanh trên → cao hết màn hình.
  return <>
    <style>{"#hs-util{height:calc(100dvh - 4rem)}@media (min-width:1024px){#hs-util{height:100dvh}}"}</style>
    <div id="hs-util" className="min-h-0 overflow-hidden bg-white"><UtilitiesApp boot={bootData()} /></div>
  </>;
}
