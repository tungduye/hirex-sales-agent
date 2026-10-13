import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const slot=process.env.HIREX_FB_PROFILE_SLOT?.trim()||"default";if(!/^[a-z0-9-]{1,64}$/u.test(slot))throw new Error("INVALID_FACEBOOK_PROFILE_SLOT");
const suffix=slot==="default"?"":`-${slot}`;
const root=resolve(`runtime/facebook-profile-bridge${suffix}`),configPath=resolve(root,"config.json"),searchTargetsPath=resolve(root,"search-targets.json"),stateFile=resolve(`playwright/.auth/facebook-profile-bridge-state${suffix}.json`),seenPath=resolve(root,"seen-events.json"),profileDirectory=resolve(`playwright/.auth/facebook-profile-bridge${suffix}`);
await mkdir(root,{recursive:true});
let config;try{config=JSON.parse(await readFile(configPath,"utf8"))}catch{config={port:3101,secret:randomBytes(32).toString("base64url")}}
const state=JSON.parse(await readFile(stateFile,"utf8"));
const context=await chromium.launchPersistentContext(profileDirectory,{headless:false,viewport:{width:1280,height:720},args:["--window-position=-32000,-32000","--window-size=1280,720"]});
await context.addCookies(state.cookies);
const cookies=await context.cookies();
const cUser=cookies.find(cookie=>cookie.name==="c_user")?.value;
if(!cUser)throw new Error("FACEBOOK_PROFILE_AUTH_REQUIRED");
config={...config,accountId:cUser,startedAt:new Date().toISOString()};await writeFile(configPath,JSON.stringify(config,null,2),"utf8");
const page=context.pages()[0]??await context.newPage();
let sendPage=await context.newPage();
const monitorPage=await context.newPage();
let reconnectPage=null;
let syncRequested=true;
await monitorPage.exposeFunction("__hirexInboxChanged",()=>{syncRequested=true});
async function startInboxMonitor(){
  await monitorPage.goto("https://www.facebook.com/messages/",{waitUntil:"domcontentloaded",timeout:30000});
  await monitorPage.waitForTimeout(3000);
  await monitorPage.evaluate(()=>{
    let previous="";
    const read=()=>[...document.querySelectorAll('a[href*="/messages/"][href*="/t/"]')].slice(0,8).map(node=>`${node.getAttribute("href")}|${node.textContent??""}`).join("\n");
    window.setInterval(()=>{const current=read();if(current&&previous&&current!==previous)void window.__hirexInboxChanged();previous=current},1000);
  });
}
void startInboxMonitor().catch(error=>console.error("Inbox monitor failed",error));
let seen;try{seen=new Set(JSON.parse(await readFile(seenPath,"utf8")))}catch{seen=new Set()}
const recentSentEchoes=[];
const threadRecipientAliases=new Map();

function equal(left,right){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b)}
async function body(request){const chunks=[];for await(const chunk of request)chunks.push(chunk);return Buffer.concat(chunks).toString("utf8")}
function verified(request,path,payload="",idempotencyKey=""){
  const timestamp=String(request.headers["x-hirex-timestamp"]??""),signature=String(request.headers["x-hirex-signature"]??"");
  if(!/^\d+$/u.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
  const canonical=`${request.method}\n${path}\n${timestamp}\n${idempotencyKey}\n${payload}`,expected=createHmac("sha256",config.secret).update(canonical).digest("hex");return equal(signature,expected);
}
function json(response,status,value){response.writeHead(status,{"content-type":"application/json"});response.end(JSON.stringify(value))}
function currentHealth(){
  const urls=[page.url(),sendPage.url(),monitorPage.url()];
  if(urls.some(value=>/facebook\.com\/(?:checkpoint|login|recover)/iu.test(value)))return"AUTH_REQUIRED";
  if(urls.some(value=>/facebook\.com\/messages/iu.test(value)))return"HEALTHY";
  return"UNKNOWN";
}

function messengerThreadId(value){
  try{return new URL(value).pathname.match(/\/messages\/(?:e2ee\/)?t\/([^/]+)/u)?.[1]??null}catch{return null}
}
async function writeSendDiagnostic(name,error){
  const checkedAt=new Date().toISOString(),message=error instanceof Error?error.message:String(error??"UNKNOWN");
  await writeFile(resolve(root,"last-send.json"),JSON.stringify({checkedAt,name,url:sendPage.url(),message},null,2),"utf8").catch(()=>undefined);
  await sendPage.screenshot({path:resolve(root,"last-send.png"),fullPage:false}).catch(()=>undefined);
}
async function openMessageComposer(target){
  // Recreate only before composing; never retry after pressing Send.
  if(sendPage.isClosed())sendPage=await context.newPage();
  await sendPage.goto("about:blank");
  await sendPage.goto(`https://www.facebook.com/messages/t/${encodeURIComponent(target)}`,{waitUntil:"domcontentloaded",timeout:30000});
  await sendPage.waitForTimeout(1500);
  const resolvedThreadId=messengerThreadId(sendPage.url());
  if(resolvedThreadId!==target)throw new Error("FACEBOOK_PROFILE_THREAD_ID_MISMATCH");
  const composer=sendPage.locator('[contenteditable="true"][role="textbox"]').last();
  await composer.waitFor({state:"visible",timeout:5000});
  return{composer,threadId:resolvedThreadId};
}

const server=createServer(async(request,response)=>{
  try{
    const url=new URL(request.url??"/","http://127.0.0.1"),healthPath=`/v1/accounts/${encodeURIComponent(config.accountId)}/health`;
    if(request.method==="GET"&&url.pathname===healthPath)return json(response,200,{status:currentHealth()});
    if(request.method==="POST"&&url.pathname==="/v1/session/reconnect"){
      if(!equal(String(request.headers.authorization??""),`Bearer ${config.secret}`))return json(response,401,{status:"FORBIDDEN"});
      if(!reconnectPage||reconnectPage.isClosed())reconnectPage=await context.newPage();
      await reconnectPage.goto("https://www.facebook.com/messages/",{waitUntil:"domcontentloaded",timeout:30000});
      const session=await context.newCDPSession(reconnectPage);
      try{const {windowId}=await session.send("Browser.getWindowForTarget");await session.send("Browser.setWindowBounds",{windowId,bounds:{windowState:"normal"}});await session.send("Browser.setWindowBounds",{windowId,bounds:{left:80,top:80,width:1280,height:800}});await reconnectPage.bringToFront();}finally{await session.detach();}
      return json(response,200,{status:"OPENED"});
    }
    if(request.method==="POST"&&url.pathname==="/v1/messages/send"){
      const raw=await body(request),key=String(request.headers["x-hirex-idempotency-key"]??"");if(!verified(request,url.pathname,raw,key))return json(response,401,{status:"FAILED"});
      const health=currentHealth();if(health!=="HEALTHY")return json(response,409,{status:health});
      const input=JSON.parse(raw),allowedSource=input.source==="HUMAN_MANUAL"||input.source==="CAMPAIGN"||(input.source==="AI_AUTOMATION"&&/^ai-recruiter:[0-9a-f-]{36}:part:\d+$/iu.test(key));if(input.accountId!==config.accountId||!allowedSource||typeof input.threadId!=="string"||typeof input.text!=="string"||!input.text.trim())return json(response,400,{status:"FAILED"});
      let opened;try{opened=await openMessageComposer(input.threadId)}catch(error){await writeSendDiagnostic("OPEN_THREAD_FAILED",error);return json(response,422,{status:"FAILED",reason:"THREAD_UNAVAILABLE"})}
      const {composer,threadId}=opened;
      await composer.fill(input.text);await composer.press("Enter");
      await sendPage.waitForFunction(text=>[...document.querySelectorAll('[role="article"] [data-scope="messages_table"]')].some(node=>(node.innerText??"").includes(text)),input.text.trim(),{timeout:15000}).catch(async error=>{await writeSendDiagnostic("SEND_NOT_CONFIRMED",error);throw error});
      recentSentEchoes.push({text:input.text.trim(),recipientExternalId:input.threadId,expiresAt:Date.now()+120000});
      await writeSendDiagnostic("SENT",null);
      const messageId=createHash("sha256").update(`${config.accountId}:${key}`).digest("hex").slice(0,32);return json(response,200,{status:"SENT",messageId,threadId});
    }
    return json(response,404,{status:"NOT_FOUND"});
  }catch(error){await writeSendDiagnostic("UNEXPECTED",error);return json(response,500,{status:"UNKNOWN"})}
});
server.listen(config.port,"127.0.0.1");

function eventHash(value){return createHash("sha256").update(value).digest("hex")}
async function pushEvent(event){
  const payload=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000).toString(),signature=createHmac("sha256",config.secret).update(`${timestamp}.${payload}`).digest("hex"),options={method:"POST",headers:{"content-type":"application/json","x-hirex-timestamp":timestamp,"x-hirex-signature":signature},body:payload};
  const targets=[process.env.HIREX_FACEBOOK_PROFILE_WEBHOOK_URL?.trim(),"https://app.hirexmkt.online/api/webhooks/facebook-profile","http://127.0.0.1:3000/api/webhooks/facebook-profile"].filter(Boolean);
  for(const target of [...new Set(targets)]){
    try{const response=await fetch(target,options);if(response.ok)return true;console.error(`Webhook rejected ${response.status} at ${target}: ${await response.text()}`)}catch(error){console.error(`Webhook unavailable at ${target}: ${error instanceof Error?error.message:"UNKNOWN"}`)}
  }
  return false;
}
async function discoverThreadHrefs(){
  const hrefs=new Map();
  const collect=async()=>{
    const values=await page.locator('a[href*="/messages/"][href*="/t/"]').evaluateAll(nodes=>nodes.map(node=>({href:node.getAttribute("href"),preview:(node.innerText??"").trim()})).filter(item=>item.href));
    for(const item of values)hrefs.set(item.href,item.preview);
  };
  const collectVirtualizedList=async()=>{
    await page.mouse.move(260,420);
    for(let index=0;index<24;index++){
      await page.mouse.wheel(0,700);
      await page.waitForTimeout(250);
      await collect();
    }
    await page.mouse.wheel(0,-20000);
    await page.waitForTimeout(500);
  };
  const clickVisibleText=async label=>{
    const candidates=page.getByText(label,{exact:true});
    for(let index=0;index<await candidates.count();index++){
      const candidate=candidates.nth(index);
      if(await candidate.isVisible().catch(()=>false)){await candidate.click();return true}
    }
    return false;
  };
  await collect();
  await collectVirtualizedList();
  for(const label of ["Unread","Groups","All"]){
    if(!await clickVisibleText(label).catch(()=>false))continue;
    await page.waitForTimeout(1500);
    await collect();
    await collectVirtualizedList();
  }
  await page.goto("https://www.facebook.com/messages/requests/",{waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForTimeout(3000);
  await collect();
  await collectVirtualizedList();
  for(const label of ["You may know","Spam"]){
    if(!await clickVisibleText(label).catch(()=>false))continue;
    await page.waitForTimeout(2000);
    await collect();
    await collectVirtualizedList();
  }
  let searchTargets=[];try{searchTargets=JSON.parse(await readFile(searchTargetsPath,"utf8"))}catch{}
  for(const target of Array.isArray(searchTargets)?searchTargets:[]){
    if(typeof target!=="string"||!target.trim())continue;
    await page.goto("https://www.facebook.com/messages/",{waitUntil:"domcontentloaded",timeout:30000});await page.waitForTimeout(2500);
    const search=page.locator('input[placeholder*="Search" i], [role="combobox"][aria-label*="Search" i]').first();
    if(!await search.isVisible().catch(()=>false))continue;
    await search.fill(target.trim());await page.waitForTimeout(2500);await collect();
    const result=page.getByText(target.trim(),{exact:true}).first();
    if(await result.isVisible().catch(()=>false)){
      await result.click();await page.waitForTimeout(2000);
      if(/\/messages\/.*\/t\//u.test(page.url()))hrefs.set(new URL(page.url()).pathname,target.trim());
    }
  }
  return [...hrefs].slice(0,50).map(([href,preview])=>({href,preview}));
}
async function discoverRecentThreadHrefs(limit=8){
  await page.goto("https://www.facebook.com/messages/",{waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForTimeout(2500);
  const values=await page.locator('a[href*="/messages/"][href*="/t/"]').evaluateAll((nodes,max)=>nodes.map(node=>({href:node.getAttribute("href"),preview:(node.innerText??"").trim()})).filter(item=>item.href).slice(0,max),limit);
  return [...new Map(values.map(item=>[item.href,item])).values()];
}
async function discoverSearchTargetHrefs(){
  const hrefs=new Map();
  let searchTargets=[];try{searchTargets=JSON.parse(await readFile(searchTargetsPath,"utf8"))}catch{}
  for(const target of Array.isArray(searchTargets)?searchTargets:[]){
    if(typeof target!=="string"||!target.trim())continue;
    await page.goto("https://www.facebook.com/messages/",{waitUntil:"domcontentloaded",timeout:30000});await page.waitForTimeout(2500);
    const search=page.locator('input[placeholder*="Search" i], [role="combobox"][aria-label*="Search" i]').first();
    if(!await search.isVisible().catch(()=>false))continue;
    await search.fill(target.trim());await page.waitForTimeout(2500);
    const result=page.getByText(target.trim(),{exact:true}).first();
    if(!await result.isVisible().catch(()=>false))continue;
    await result.click();await page.waitForTimeout(2000);
    if(/\/messages\/.*\/t\//u.test(page.url()))hrefs.set(new URL(page.url()).pathname,target.trim());
  }
  return [...hrefs].map(([href,preview])=>({href,preview}));
}
async function syncThreadEntries(threadEntries,mode){
  let discovered=0,accepted=0;
  for(const {href,preview} of threadEntries){
    await page.goto("about:blank");
    await page.goto(new URL(href,"https://www.facebook.com").toString(),{waitUntil:"domcontentloaded",timeout:30000});
    const threadId=href.match(/\/t\/([^/]+)/u)?.[1];if(!threadId)continue;
    await page.waitForURL(url=>url.pathname.includes(`/t/${threadId}`),{timeout:10000});
    await page.locator('[role="article"] [data-scope="messages_table"][aria-label]').first().waitFor({state:"attached",timeout:4000}).catch(()=>undefined);
    await page.waitForTimeout(700);
    const headingName=await page.locator('h1,h2,h3,[role="heading"]').evaluateAll(nodes=>nodes.map(node=>(node.textContent??"").trim()).find(text=>text.startsWith("Conversation with "))?.slice("Conversation with ".length).trim()||null);
    const sidebarName=await page.locator(`a[href*="/t/${threadId}"]`).first().evaluate(node=>(node.innerText??"").trim().split(/\r?\n/u)[0]?.trim()||null).catch(()=>null);
    const conversationName=headingName||sidebarName;
    const messages=await page.locator('[role="article"] [data-scope="messages_table"][aria-label]').evaluateAll(nodes=>{const placeholders=new Set(["không khôi phục được tin nhắn","couldn't restore message","could not restore message","this message could not be restored"]),delivery=/^(?:đã gửi|đã xem|sent|seen)(?:\s+.*)?$/iu;return nodes.map(node=>{const providerMessageId=node.getAttribute("data-message-id"),label=node.getAttribute("aria-label"),lines=(node.innerText??"").trim().split(/\r?\n/u).map(line=>line.trim()).filter(Boolean),hasDeliveryStatus=lines.some(line=>delivery.test(line)),text=lines.filter(line=>!delivery.test(line)).join("\n").trim();const attachments=[...node.querySelectorAll('img[alt="Open photo"]')].map((image,index)=>{const url=image.currentSrc||image.src;const match=url.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/u);if(!match)return null;const extension=match[1]==="image/png"?"png":"jpg";return{id:providerMessageId?`${providerMessageId}:${index}`:null,filename:`facebook-${index+1}.${extension}`,contentType:match[1],sizeBytes:Math.floor(match[2].length*3/4),url}}).filter(Boolean);return{label,providerMessageId,text,attachments,isSelfHint:hasDeliveryStatus||/(?:^|[,\s])(you|bạn)(?:\s+(?:sent|đã gửi)|\s*[:,])/iu.test(label??"")}}).filter(item=>item.label&&(item.text||item.attachments.length)&&!(item.attachments.length===0&&placeholders.has(item.text.toLocaleLowerCase("vi")))).slice(-100)});
    if(messages.length===0&&preview){
      const lines=preview.split(/\r?\n/u).map(line=>line.trim()).filter(Boolean),name=lines[0]||"Facebook contact";
      const text=lines.slice(1).find(line=>line!=="Unread message:"&&line!=="·"&&!/^\d+[mhd]$/iu.test(line));
      if(text)messages.push({label:`Preview, ${name}: ${text}`,providerMessageId:null,text,attachments:[]});
    }
    discovered+=messages.length;
    for(const item of messages){
      const match=item.label.match(/^[^,]+,\s*([^:]{1,255})(?::|$)/u);if(!match)continue;
      const isSelf=item.isSelfHint||match[1].trim().toLowerCase()==="you";
      const now=Date.now();
      while(recentSentEchoes[0]&&recentSentEchoes[0].expiresAt<=now)recentSentEchoes.shift();
      if(isSelf){
        const echoIndex=recentSentEchoes.findIndex(entry=>entry.text===item.text.trim()&&entry.expiresAt>now);
        if(echoIndex>=0){const[echo]=recentSentEchoes.splice(echoIndex,1);threadRecipientAliases.set(threadId,echo.recipientExternalId)}
      }
      const participantExternalId=threadRecipientAliases.get(threadId)??threadId;
      const stableMessageId=item.providerMessageId||eventHash(`${threadId}:${item.label}:${item.text??""}:${item.attachments.map(attachment=>attachment.url).join("|")}`);
      const eventId=eventHash(`${config.accountId}:${threadId}:${isSelf?"OUT":"IN"}:${stableMessageId}`);if(seen.has(eventId))continue;
      const messageId=eventHash(`message:${eventId}`);
      const event={eventId,accountId:config.accountId,threadId,messageId,senderId:isSelf?config.accountId:participantExternalId,senderName:isSelf?"You":conversationName||match[1].trim(),accountName:"Facebook cá nhân",recipientIds:[isSelf?participantExternalId:config.accountId],text:item.text||null,isSelf,attachments:item.attachments,occurredAt:new Date().toISOString()};
      if(await pushEvent(event)){seen.add(eventId);accepted++;await writeFile(seenPath,JSON.stringify([...seen].slice(-10000)),"utf8")}
    }
  }
  return{mode,threads:threadEntries.length,discovered,accepted};
}
let syncRunning=false,cycle=0,backfillQueue=[];
async function synchronize(){
  if(syncRunning)return;
  syncRunning=true;
  try{
    const targetedEntries=cycle===0?await discoverSearchTargetHrefs():[];
    const recentEntries=await discoverRecentThreadHrefs();
    cycle++;
    if(cycle%60===0){
      const discoveredEntries=await discoverThreadHrefs();
      const recentHrefs=new Set(recentEntries.map(item=>item.href));
      backfillQueue=discoveredEntries.filter(item=>!recentHrefs.has(item.href));
    }
    const backfillEntries=backfillQueue.splice(0,2);
    const threadEntries=[...new Map([...targetedEntries,...recentEntries,...backfillEntries].map(item=>[item.href,item])).values()];
    await page.screenshot({path:resolve(root,"last-sync.png"),fullPage:false}).catch(()=>undefined);
    const result=await syncThreadEntries(threadEntries,backfillEntries.length>0?"RECENT_AND_BACKFILL":"RECENT");
    await writeFile(resolve(root,"sync-status.json"),JSON.stringify({checkedAt:new Date().toISOString(),url:page.url(),title:await page.title().catch(()=>null),...result,backfillRemaining:backfillQueue.length,seen:seen.size},null,2),"utf8");
  }catch(error){await writeFile(resolve(root,"sync-status.json"),JSON.stringify({checkedAt:new Date().toISOString(),error:error instanceof Error?error.message:"UNKNOWN"},null,2),"utf8")}
  finally{syncRunning=false}
}
void synchronize();const syncTimer=setInterval(()=>{if(!syncRequested)return;syncRequested=false;void synchronize()},1000),reconcileTimer=setInterval(()=>{syncRequested=true},15000);
const shutdown=async()=>{clearInterval(syncTimer);clearInterval(reconcileTimer);server.close();await context.close();process.exit(0)};process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
