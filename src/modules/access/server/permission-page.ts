import "server-only";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { PermissionKey } from "@/modules/access/core/permission-catalog";
import { hasPermission } from "./access-control";

export async function PermissionPage({permission,children}:{permission:PermissionKey;children:ReactNode}){
  if(!await hasPermission(permission))redirect("/");
  return children;
}
