import { getCustomerPanel } from "@/modules/inbox/server/customer-panel";

export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId: id } = await params;
  if (!/^[0-9a-f-]{36}$/iu.test(id)) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  const data = await getCustomerPanel(id);
  if (!data) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
