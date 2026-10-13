const secret=process.env.AUTOMATION_CRON_SECRET?.trim();
const endpoint=process.env.HIREX_INTERNAL_BASE_URL?.trim()||"http://127.0.0.1:3000";
if(!secret){console.error("AI Recruiter worker disabled: AUTOMATION_CRON_SECRET is missing.");process.exit(1)}
let stopping=false;
process.on("SIGINT",()=>{stopping=true});process.on("SIGTERM",()=>{stopping=true});

// Poll every 5s while healthy. While the web app is unreachable or failing, back off
// 5s -> 10s -> 20s ... up to 60s and log only when the error changes, on failures
// 1/2/4/8/..., and once on recovery, so an outage does not flood the log.
const BASE_DELAY_MS=5000,MAX_DELAY_MS=60000;
let failures=0,lastError="";
const isPowerOfTwo=(count)=>(count&(count-1))===0;
while(!stopping){
  let error="";
  try{
    const response=await fetch(`${endpoint}/api/internal/ai-recruiter/process`,{method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},body:JSON.stringify({limit:10}),signal:AbortSignal.timeout(120000)});
    if(!response.ok)error=`HTTP ${response.status}`;
  }catch(caught){error=caught instanceof Error?caught.message:"unavailable"}
  if(error){
    failures+=1;
    if(error!==lastError||isPowerOfTwo(failures))console.error(`AI Recruiter worker retry: ${error} (failure #${failures})`);
    lastError=error;
  }else if(failures>0){
    console.error(`AI Recruiter worker recovered after ${failures} failures`);
    failures=0;lastError="";
  }
  const delay=failures===0?BASE_DELAY_MS:Math.min(BASE_DELAY_MS*2**Math.min(failures-1,10),MAX_DELAY_MS);
  await new Promise((resolve)=>setTimeout(resolve,delay));
}
