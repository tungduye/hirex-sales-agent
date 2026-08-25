import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/shared/coming-soon";

const sections = {
  inbox: {
    title: "Inbox",
    description: "A unified place for customer conversations is planned for a later phase.",
  },
  campaigns: {
    title: "Campaigns",
    description: "Campaign creation and delivery are outside the Phase 1A scope.",
  },
  tasks: {
    title: "Tasks",
    description: "Task management will be connected to CRM records in an upcoming phase.",
  },
  analytics: {
    title: "Analytics",
    description: "Sales reporting will appear here once the underlying workflows are ready.",
  },
  settings: {
    title: "Settings",
    description: "Workspace, team, and integration settings will be added incrementally.",
  },
} as const;

type Section = keyof typeof sections;

export default async function SectionPage({
  params,
}: PageProps<"/[section]">) {
  const { section } = await params;

  if (!(section in sections)) {
    notFound();
  }

  return <ComingSoon {...sections[section as Section]} />;
}
