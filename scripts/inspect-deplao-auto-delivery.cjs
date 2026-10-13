/* eslint-disable @typescript-eslint/no-require-imports -- Electron helper loads Deplao's native better-sqlite3 build. */
const Database=require("C:/Users/Admin/deplao-hirex-fork/node_modules/better-sqlite3");
const {writeFileSync}=require("node:fs");
const db=new Database("C:/Users/Admin/AppData/Local/HireX/ZaloRuntime/deplao-qa-profile/deplao-tool.db",{readonly:true});
const result=db.prepare(`select msg_id,owner_zalo_id,thread_id,sender_id,content,timestamp,is_sent,status,msg_type
  from messages where owner_zalo_id=? and thread_id=? order by timestamp desc limit 20`)
  .all("111892620045444006","7072192248263976974");
writeFileSync("C:/Users/Admin/hirex-sales-agent/runtime/deplao-auto-delivery.json",JSON.stringify(result));
db.close();
