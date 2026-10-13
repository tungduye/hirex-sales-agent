import {createHmac,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
const target=process.argv[2],text=process.argv.slice(3).join(" ").trim()||"hi em";
const setups={
  phuong:{slot:"ea741519-03b1-41b7-b346-c58bcb3d0253",senderId:"100025779810107",senderName:"Tung Duy"},
  tung:{slot:"39e4ad4c-2af1-48a5-8b9f-ef33042b8f4d",senderId:"61594612904827",senderName:"Phuong Anh Tran"},
};
const setup=setups[target];if(!setup)throw new Error("Usage: phuong|tung <text>");
const config=JSON.parse(await readFile(`runtime/facebook-profile-bridge-${setup.slot}/config.json`,"utf8"));
const id=randomUUID(),payload=JSON.stringify({eventId:`test-${id}`,accountId:config.accountId,threadId:setup.senderId,messageId:`test-${id}`,senderId:setup.senderId,senderName:setup.senderName,accountName:"Facebook cá nhân",recipientIds:[config.accountId],text,isSelf:false,occurredAt:new Date().toISOString(),attachments:[]});
const timestamp=Math.floor(Date.now()/1000).toString(),signature=createHmac("sha256",config.secret).update(`${timestamp}.${payload}`).digest("hex");
const response=await fetch("https://app.hirexmkt.online/api/webhooks/facebook-profile",{method:"POST",headers:{"content-type":"application/json","x-hirex-timestamp":timestamp,"x-hirex-signature":signature},body:payload});
console.log(JSON.stringify({status:response.status,body:await response.text(),accountId:config.accountId,threadId:setup.senderId}));
