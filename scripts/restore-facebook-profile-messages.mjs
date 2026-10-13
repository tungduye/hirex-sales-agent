import {chromium} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

const profileDirectory=resolve("playwright/.auth/facebook-profile-bridge");
const state=JSON.parse(await readFile(resolve("playwright/.auth/facebook-profile-bridge-state.json"),"utf8"));
const context=await chromium.launchPersistentContext(profileDirectory,{headless:false,viewport:null,args:["--start-maximized"]});
await context.addCookies(state.cookies);
const page=context.pages()[0]??await context.newPage();
await page.goto("https://www.facebook.com/messages/",{waitUntil:"domcontentloaded",timeout:30000});
await new Promise(resolvePromise=>context.browser()?.once("disconnected",resolvePromise));
