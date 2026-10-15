import { EmptyConversationSelection } from "@/modules/inbox/components/omnichannel-inbox-view";

// The conversation list is rendered by the layout (InboxShell); this page is only the empty right pane.
export default function OmnichannelInboxPage() {
  return <EmptyConversationSelection/>;
}
