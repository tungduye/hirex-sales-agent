import type {ReactNode} from "react";import {PermissionPage} from "@/modules/access/server/permission-page";
export default function Layout({children}:{children:ReactNode}){return <PermissionPage permission="inbox.view">{children}</PermissionPage>}
