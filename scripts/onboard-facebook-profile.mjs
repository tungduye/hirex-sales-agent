import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { openSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const slot=process.env.HIREX_FB_PROFILE_SLOT?.trim()||"";
const displayName=process.env.HIREX_FB_PROFILE_DISPLAY_NAME?.trim()||"Facebook cá nhân";
if(!/^[a-z0-9-]{1,64}$/u.test(slot))throw new Error("INVALID_FACEBOOK_PROFILE_SLOT");
const statusDirectory=resolve("runtime/facebook-profile-onboarding"),statusPath=resolve(statusDirectory,`${slot}.json`);
await mkdir(statusDirectory,{recursive:true});
const status=async(state,message)=>writeFile(statusPath,JSON.stringify({state,message,updatedAt:new Date().toISOString()},null,2),"utf8");
const run=(script,extraEnv={})=>new Promise((resolvePromise,reject)=>{
  const child=spawn(process.execPath,["--env-file=.env.local",resolve(script)],{cwd:process.cwd(),env:{...process.env,...extraEnv},stdio:"ignore",windowsHide:false});
  child.once("error",reject);child.once("exit",code=>code===0?resolvePromise():reject(new Error(`PROCESS_EXIT_${code}`)));
});
const availablePort=()=>new Promise((resolvePromise,reject)=>{
  const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const address=server.address();if(!address||typeof address==="string")return reject(new Error("PORT_UNAVAILABLE"));const port=address.port;server.close(()=>resolvePromise(port));});
});

try{
  await status("WAITING_FOR_LOGIN","Cửa sổ Facebook đã mở. Hãy đăng nhập và hoàn tất mã 2FA trực tiếp trên Facebook.");
  const port=await availablePort(),root=resolve(`runtime/facebook-profile-bridge-${slot}`);
  await mkdir(root,{recursive:true});
  await writeFile(resolve(root,"config.json"),JSON.stringify({port,secret:randomBytes(32).toString("base64url"),startedAt:new Date().toISOString()},null,2),"utf8");
  const env={HIREX_FB_PROFILE_SLOT:slot,HIREX_FB_PROFILE_DISPLAY_NAME:displayName};
  await run("scripts/capture-facebook-profile-bridge-auth.mjs",env);
  await status("STARTING_BRIDGE","Đăng nhập thành công. HireX đang kích hoạt đồng bộ.");
  const out=resolve(root,"stdout.log"),err=resolve(root,"stderr.log");
  const bridge=spawn(process.execPath,["--env-file=.env.local",resolve("scripts/facebook-profile-bridge.mjs")],{cwd:process.cwd(),env:{...process.env,...env},detached:true,stdio:["ignore",openSync(out,"a"),openSync(err,"a")],windowsHide:true});
  bridge.unref();
  const deadline=Date.now()+30000;let healthy=false;
  while(Date.now()<deadline){try{const config=JSON.parse(await readFile(resolve(root,"config.json"),"utf8"));if(typeof config.accountId==="string"){const response=await fetch(`http://127.0.0.1:${port}/v1/accounts/${encodeURIComponent(config.accountId)}/health`);if(response.ok){healthy=true;break}}}catch{}await new Promise(resolvePromise=>setTimeout(resolvePromise,1000));}
  if(!healthy)throw new Error("BRIDGE_START_TIMEOUT");
  // The bridge writes the Facebook account id into config before it starts listening.
  await run("scripts/connect-facebook-profile-bridge.mjs",env);
  await status("CONNECTED","Đã kết nối Facebook cá nhân và bắt đầu đồng bộ.");
}catch(error){await status("ERROR",error instanceof Error?error.message:"Không thể kết nối Facebook cá nhân.");process.exitCode=1;}
