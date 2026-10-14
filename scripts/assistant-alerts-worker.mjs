// Trợ lý HireX alerts: asks the web app to scan for problems every 5 minutes (channel accounts down,
// e-mail sender stopped, customers waiting too long). Launched by start-production.mjs.
const secret=process.env.AUTOMATION_CRON_SECRET?.trim();
const endpoint=process.env.HIREX_INTERNAL_BASE_URL?.trim()||"http://127.0.0.1:3000";
if(!secret){console.error("Assistant alerts worker disabled: AUTOMATION_CRON_SECRET is missing.");process.exit(1)}
let stopping=false;
process.on("SIGINT",()=>{stopping=true});process.on("SIGTERM",()=>{stopping=true});

const INTERVAL_MS=5*60_000,FIRST_DELAY_MS=60_000;
let failures=0;
await new Promise((resolve)=>setTimeout(resolve,FIRST_DELAY_MS));
while(!stopping){
  try{
    const response=await fetch(`${endpoint}/api/internal/assistant/alerts`,{method:"POST",headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(180000)});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    if(failures>0)console.error(`Assistant alerts worker recovered after ${failures} failures`);
    failures=0;
  }catch(caught){
    failures+=1;
    if((failures&(failures-1))===0)console.error(`Assistant alerts scan failed: ${caught instanceof Error?caught.message:"unavailable"} (failure #${failures})`);
  }
  await new Promise((resolve)=>setTimeout(resolve,INTERVAL_MS));
}
