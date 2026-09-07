import {spawn,spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {loadPhase4cQaEnv} from "./load-phase4c-qa-env.mjs";

const {missing}=loadPhase4cQaEnv();
if(missing.length){process.exit(2)}
const directory=resolve(import.meta.dirname,"../supabase/tests/concurrency");
if(process.env.HIREX_ALLOW_REMOTE_SYNTHETIC_TESTS!=="1"){console.error("Remote synthetic concurrency is disabled.");process.exit(2)}
const databaseUrl=process.env.SUPABASE_DB_URL||process.env.DATABASE_URL;
if(!databaseUrl){console.error("A remote PostgreSQL connection URL is required.");process.exit(2)}
const nativePsql=spawnSync("psql",["--version"],{stdio:"ignore"}).status===0;
function spawnPsql(args,stdio){
  if(nativePsql)return spawn("psql",[databaseUrl,"-X","--set=ON_ERROR_STOP=1","--set=VERBOSITY=sqlstate",...args],{stdio});
  return spawn("docker",["run","--rm","-i","-e","DATABASE_URL","-v",`${directory}:/tests:ro`,"postgres:17","sh","-c",`psql \"$DATABASE_URL\" -X --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate ${args.join(" ")}`],{stdio,env:{...process.env,DATABASE_URL:databaseUrl}});
}

function fileArgs(file){return ["-f",nativePsql?resolve(directory,file):`/tests/${file}`]}
function safeSqlFailure(file,stderr){
  const missing=stderr.match(/relation "([a-z0-9_.]+)" does not exist/i);
  if(missing)return `MISSING_RELATION:${file}:${missing[1]}`;
  const constraint=stderr.match(/violates check constraint "([a-z0-9_]+)"/i);
  if(constraint)return `CONSTRAINT_FAILURE:${file}:${constraint[1]}`;
  if(stderr.includes("Campaign configuration is immutable outside DRAFT"))return `CAMPAIGN_IMMUTABLE:${file}`;
  if(/password authentication failed|tenant or user not found/i.test(stderr))return `DATABASE_AUTH_FAILURE:${file}`;
  if(/could not translate host name|name or service not known/i.test(stderr))return `DATABASE_DNS_FAILURE:${file}`;
  if(/connection timed out|timeout expired/i.test(stderr))return `DATABASE_TIMEOUT:${file}`;
  if(/connection refused|could not connect to server/i.test(stderr))return `DATABASE_CONNECTION_FAILURE:${file}`;
  if(/no pg_hba.conf entry|ssl/i.test(stderr))return `DATABASE_TLS_OR_ACCESS_FAILURE:${file}`;
  if(/syntax error/i.test(stderr))return `SQL_SYNTAX_FAILURE:${file}`;
  if(/permission denied/i.test(stderr))return `DATABASE_PERMISSION_FAILURE:${file}`;
  if(/docker:|invalid volume specification|mount denied|unable to find image/i.test(stderr))return `DOCKER_RUNTIME_FAILURE:${file}`;
  const sqlState=stderr.match(/ERROR:\s+([0-9A-Z]{5})/);
  if(sqlState)return `SQLSTATE_${sqlState[1]}:${file}`;
  return `SQL_TEST_FAILED:${file}`;
}
function runFile(file){return new Promise((accept,reject)=>{const child=spawnPsql(fileArgs(file),["ignore","pipe","pipe"]);let output="",stderr="";child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);child.on("error",()=>reject(new Error(`PSQL_UNAVAILABLE:${file}`)));child.on("close",code=>code===0?accept(output):reject(new Error(`${safeSqlFailure(file,stderr)}:EXIT_${code}`)))})}
async function race(sessionA,sessionB,verify){const sql=await readFile(resolve(directory,sessionA),"utf8");const a=spawnPsql([],["pipe","pipe","pipe"]);let aOutput="";let markerResolve;const marker=new Promise(resolveMarker=>markerResolve=resolveMarker);a.stdout.on("data",chunk=>{aOutput+=chunk;if(aOutput.includes("marker"))markerResolve()});a.stderr.on("data",()=>{});a.stdin.write(sql);await Promise.race([marker,new Promise((_,reject)=>setTimeout(()=>reject(new Error("SESSION_A_TIMEOUT")),30_000))]);const bResult=runFile(sessionB);await new Promise(resolveWait=>setTimeout(resolveWait,500));a.stdin.end("\ncommit;\n");const [aCode]=await Promise.all([new Promise(resolveClose=>a.on("close",resolveClose)),bResult]);if(aCode!==0)throw new Error("SESSION_A_FAILED");await runFile(verify);return aOutput}

let failed=false;
try{
  // Cleanup is deterministic and scoped to the reserved 970... fixture namespace.
  await runFile("016_cleanup.sql");
  await runFile("016_setup.sql");
  await race("same_step_session_a.sql","same_step_session_b.sql","verify_same_step.sql");
  await race("global_quota_session_a.sql","global_quota_session_b.sql","verify_global_quota.sql");
  await runFile("stale_reclaim.sql");await runFile("verify_stale_reclaim.sql");
  await race("reply_race_session_a.sql","reply_race_session_b.sql","verify_reply_race.sql");
  console.log("REMOTE_SAME_STEP_PASS");
  console.log("REMOTE_GLOBAL_QUOTA_PASS");
  console.log("REMOTE_STALE_RECLAIM_PASS");
  console.log("REMOTE_REPLY_RACE_PASS");
}catch(error){failed=true;console.error(`PHASE4C_REMOTE_CONCURRENCY_FAILED:${error instanceof Error?error.message:"UNKNOWN"}`)}
finally{try{await runFile("016_cleanup.sql");console.log("PHASE4C_REMOTE_CLEANUP_PASS")}catch(error){failed=true;console.error(`PHASE4C_REMOTE_CLEANUP_FAILED:${error instanceof Error?error.message:"UNKNOWN"}`)}}
process.exitCode=failed?1:0;
