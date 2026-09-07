import {chromium} from "@playwright/test";
import {mkdir,access} from "node:fs/promises";
import {resolve} from "node:path";
import {loadPhase4cQaEnv} from "./load-phase4c-qa-env.mjs";
loadPhase4cQaEnv();
const statePath=resolve("playwright/.auth/hirex.json");
await mkdir(resolve("playwright/.auth"),{recursive:true});
let existing=false;try{await access(statePath);existing=true}catch{}
const browser=await chromium.launch({headless:false});
const context=await browser.newContext(existing?{storageState:statePath}:{});const page=await context.newPage();await page.goto(process.env.HIREX_QA_BASE_URL||"http://localhost:3000/campaigns");
if(page.url().includes("/login")){console.log("ACTION REQUIRED: Log into HireX in this browser. Keep the window open.");await page.waitForURL(url=>!url.pathname.startsWith("/login"),{timeout:900_000})}
await page.goto(new URL("/campaigns",page.url()).toString());if(page.url().includes("/login"))throw new Error("AUTH_SESSION_UNAVAILABLE");await context.storageState({path:statePath});console.log("HIREX_E2E_AUTH_CAPTURED");await browser.close();
