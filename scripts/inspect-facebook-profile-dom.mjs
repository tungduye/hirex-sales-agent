import { chromium } from "@playwright/test";
import {readFile} from "node:fs/promises";
const context=await chromium.launchPersistentContext("playwright/.auth/facebook-profile-bridge",{headless:false,args:["--window-position=-32000,-32000","--window-size=1280,720"]});
const state=JSON.parse(await readFile("playwright/.auth/facebook-profile-bridge-state.json","utf8"));
await context.addCookies(state.cookies);
const page=await context.newPage();
await page.goto("https://www.facebook.com/messages/",{waitUntil:"domcontentloaded",timeout:30000});
await page.waitForTimeout(15000);
await page.screenshot({path:"runtime/facebook-profile-bridge/inspect.png",fullPage:false});
const data=await page.evaluate(()=>({
  url:location.href,title:document.title,
  threadLinks:[...document.querySelectorAll('a[href*="/t/"]')].slice(0,30).map(anchor=>anchor.getAttribute("href")),
  contentEditables:document.querySelectorAll('[contenteditable="true"]').length,
  mainRoles:document.querySelectorAll('[role="main"]').length,
  rows:document.querySelectorAll('[role="row"]').length,
  articles:document.querySelectorAll('[role="article"]').length,
  articleShapes:[...document.querySelectorAll('[role="article"]')].slice(-5).map(article=>({
    tag:article.tagName,aria:article.getAttribute("aria-label"),classes:article.className,
    descendants:[...article.querySelectorAll("[data-scope],[data-testid],[role]")].slice(0,12).map(node=>({tag:node.tagName,role:node.getAttribute("role"),scope:node.getAttribute("data-scope"),testid:node.getAttribute("data-testid"),aria:node.getAttribute("aria-label")})),
  })),
}));
console.log(JSON.stringify(data));
await context.close();
