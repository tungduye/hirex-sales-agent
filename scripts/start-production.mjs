import { spawn } from "node:child_process";
import { resolve } from "node:path";

const children=new Set();
function launch(command,args,name,restart=false){
  const child=spawn(command,args,{cwd:process.cwd(),env:process.env,stdio:"inherit",windowsHide:true});children.add(child);
  child.on("exit",(code)=>{children.delete(child);if(restart){console.error(`${name} exited (${code}); restarting in 3 seconds`);setTimeout(()=>launch(command,args,name,true),3000)}else process.exitCode=code??1});
  return child;
}
const next=launch(process.execPath,[resolve("node_modules/next/dist/bin/next"),"start"],"next");
launch(process.execPath,["--env-file=.env.local",resolve("scripts/facebook-page-reconciler.mjs")],"facebook-page-reconciler",true);
launch(process.execPath,["--env-file=.env.local",resolve("scripts/ai-recruiter-worker.mjs")],"ai-recruiter-worker",true);
function shutdown(){for(const child of children)child.kill();setTimeout(()=>process.exit(),1000).unref()}
process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);next.on("exit",()=>shutdown());
