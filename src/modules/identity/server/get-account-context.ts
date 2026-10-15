import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { AccountContext } from "@/types/account";
import { allPermissionKeys } from "@/modules/access/core/permission-catalog";

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
  // Signed claims are checked locally when possible, avoiding an Auth round trip per request.
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (claimsError || !claims?.sub) {
    return null;
  }
  const userId = claims.sub;
  const email = typeof claims.email === "string" && claims.email ? claims.email : "Email unavailable";

  // Profile (with its workspace) and permissions are independent: load them together.
  const [{ data: profileData, error: profileError }, { data: permissionData, error: permissionError }] = await Promise.all([
    supabase.from("profiles").select("id, workspace_id, full_name, workspaces(id, name)").eq("id", userId).maybeSingle(),
    supabase.rpc("current_workspace_permissions"),
  ]);
  const profile = profileData as (ProfileRow & { workspaces: WorkspaceRow | WorkspaceRow[] | null }) | null;

  if (profileError || !profile) {
    return {
      userId,
      email,
      fullName: null,
      workspaceId: null,
      workspaceName: null,
      configurationComplete: false,
      permissions: [],
    };
  }

  const workspace = Array.isArray(profile.workspaces) ? profile.workspaces[0] ?? null : profile.workspaces;
  const permissions=permissionError?[]:(permissionData??[]).filter((value:unknown):value is string=>typeof value==="string"&&allPermissionKeys.includes(value as (typeof allPermissionKeys)[number]));
  return {
    userId,
    email,
    fullName: profile.full_name,
    workspaceId: profile.workspace_id,
    workspaceName: workspace?.name ?? null,
    configurationComplete: Boolean(workspace),
    permissions,
  };
}

export const getAccountContext = cache(loadAccountContext);
