import { publicTitle } from "../../../../moduleHS/record/api";
import { MeetingPublic } from "../../../../moduleHS/record/utilities";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ p: string[] }> };

export async function generateMetadata({ params }: Props) { const { p } = await params; return { title: publicTitle(p[0] ?? "") || "Cuộc họp" }; }

/** Trang xem công khai của Cuộc họp (link gửi qua Zalo): /m/<slug>[/<summary|transcript|translation|audio>]. */
export default async function MeetingPublicPage({ params }: Props) {
  const { p } = await params;
  return <MeetingPublic slug={p[0] ?? ""} kind={p[1] ?? ""} />;
}
