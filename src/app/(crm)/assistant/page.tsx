import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { AssistantWorkspace } from "@/modules/assistant/components/assistant-workspace";

export const metadata = { title: "Trợ lý" };

export default async function AssistantPage() {
  return <AssistantWorkspace conversationId={null} workspaceAdmin={await isWorkspaceAdmin()} />;
}
