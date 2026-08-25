import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { AccountContext } from "@/types/account";

interface ProfileRow {
  id: string;
  workspace_id: string;
  full_name: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
}

async function loadAccountContext(): Promise<AccountContext | null> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("id, workspace_id, full_name")
    .eq("id", user.id)
    .maybeSingle();
  const profile = profileData as ProfileRow | null;

  if (profileError || !profile) {
    return {
      userId: user.id,
      email: user.email ?? "Email unavailable",
      fullName: null,
      workspaceId: null,
      workspaceName: null,
      configurationComplete: false,
    };
  }

  const { data: workspaceData, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", profile.workspace_id)
    .maybeSingle();
  const workspace = workspaceData as WorkspaceRow | null;

  return {
    userId: user.id,
    email: user.email ?? "Email unavailable",
    fullName: profile.full_name,
    workspaceId: profile.workspace_id,
    workspaceName: workspace?.name ?? null,
    configurationComplete: !workspaceError && Boolean(workspace),
  };
}

export const getAccountContext = cache(loadAccountContext);
