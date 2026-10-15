import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { describeRule, ruleSchema } from "@/modules/assistant/core/assistant-rules";
import { RulesView, type RuleRow } from "@/modules/assistant/components/rules-view";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export default async function AssistantRulesPage() {
  const account = await getAccountContext();
  if (!account?.workspaceId) redirect("/login");
  const admin = await isWorkspaceAdmin();
  const db = createPrivilegedClient();
  let query = db.from("assistant_rules").select("id,name,definition,enabled,last_matched_at,created_by,created_at").eq("workspace_id", account.workspaceId).order("created_at", { ascending: false }).limit(200);
  if (!admin) query = query.eq("created_by", account.userId);
  const { data } = await query;
  const ownerIds = [...new Set((data ?? []).map((row) => row.created_by))];
  const { data: owners } = ownerIds.length ? await db.from("profiles").select("id,full_name").eq("workspace_id", account.workspaceId).in("id", ownerIds) : { data: [] as { id: string; full_name: string }[] };
  const ownerName = new Map((owners ?? []).map((row) => [row.id, row.full_name]));
  const rules: RuleRow[] = (data ?? []).map((row) => {
    const parsed = ruleSchema.safeParse(row.definition);
    return {
      id: row.id, name: row.name, enabled: row.enabled, lastMatchedAt: row.last_matched_at, createdAt: row.created_at,
      owner: row.created_by === account.userId ? "Anh/chị" : ownerName.get(row.created_by) ?? "Thành viên khác",
      lines: parsed.success ? describeRule(parsed.data).slice(0, 3) : ["Định nghĩa không hợp lệ — hãy xóa và tạo lại."],
    };
  });
  return (
    <>
      <PageHeader title="Quy tắc tự động" description={admin ? "Quy tắc của mọi thành viên. Trợ lý kiểm tra 5 phút một lần." : "Quy tắc của anh/chị. Trợ lý kiểm tra 5 phút một lần."} />
      <RulesView rules={rules} />
    </>
  );
}
