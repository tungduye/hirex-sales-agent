/* eslint-disable @typescript-eslint/no-require-imports -- Electron helper must use CommonJS so it can load Deplao's native better-sqlite3 build. */
const {writeFileSync}=require("node:fs");
const Database=require("C:/Users/Admin/deplao-hirex-fork/node_modules/better-sqlite3");
const db=new Database("C:/Users/Admin/AppData/Local/HireX/ZaloRuntime/deplao-qa-profile/deplao-tool.db",{readonly:true});
const value=JSON.stringify(db.prepare("select zalo_id,full_name,channel,is_active,listener_active from accounts where is_active=1 order by created_at").all());
writeFileSync("C:/Users/Admin/hirex-sales-agent/runtime/deplao-zalo-accounts.json",value);
db.close();
