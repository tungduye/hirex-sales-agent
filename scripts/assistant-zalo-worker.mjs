// Trợ lý trên Zalo: asks the web app to answer queued Zalo questions. Busy: one after another; idle: checks
// every 3 seconds. Launched by start-production.mjs.
const secret=process.env.AUTOMATION_CRON_SECRET?.trim();
const endpoint=process.env.HIREX_INTERNAL_BASE_URL?.trim()||"http://127.0.0.1:3000";
if(!secret){console.error("Assistant Zalo worker disabled: AUTOMATION_CRON_SECRET is missing.");process.exit(1)}
let stopping=false;
process.on("SIGINT",()=>{stopping=true});process.on("SIGTERM",()=>{stopping=true});

const IDLE_MS=3000,FIRST_DELAY_MS=20_000;
let failures=0;
await new Promise((resolve)=>setTimeout(resolve,FIRST_DELAY_MS));
while(!stopping){
  let busy=false;
  try{
    const response=await fetch(`${endpoint}/api/internal/assistant/zalo`,{method:"POST",headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(180000)});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const result=await response.json().catch(()=>({}));
    busy=result?.processed===true;
    if(failures>0)console.error(`Assistant Zalo worker recovered after ${failures} failures`);
    failures=0;
  }catch(caught){
    failures+=1;
    if((failures&(failures-1))===0)console.error(`Assistant Zalo worker failed: ${caught instanceof Error?caught.message:"unavailable"} (failure #${failures})`);
  }
  if(!busy)await new Promise((resolve)=>setTimeout(resolve,failures?Math.min(60000,IDLE_MS*failures):IDLE_MS));
}
