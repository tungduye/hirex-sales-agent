import { notFound } from "next/navigation";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { AssistantWorkspace } from "@/modules/assistant/components/assistant-workspace";

export const metadata = { title: "Trợ lý" };

export default async function AssistantConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  if (!/^[0-9a-f-]{36}$/iu.test(conversationId)) notFound();
  return <AssistantWorkspace conversationId={conversationId} workspaceAdmin={await isWorkspaceAdmin()} />;
}
