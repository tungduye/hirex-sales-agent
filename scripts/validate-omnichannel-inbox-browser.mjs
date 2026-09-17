import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const authPath = new URL("../playwright/.auth/hirex.json", import.meta.url);
const baseUrl = process.env.HIREX_BROWSER_BASE_URL ?? process.env.HIREX_QA_BASE_URL ?? "http://localhost:3000";
assert.ok(existsSync(authPath), "Authenticated Playwright state is required");
const browser = await chromium.launch({ headless: true });
let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };
try {
  const context = await browser.newContext({ storageState: authPath.pathname.slice(1) });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/inbox/all`, { waitUntil: "domcontentloaded" });
  check(!page.url().endsWith("/login"), "authenticated unified inbox");
  check(await page.getByRole("heading", { name: "Unified Inbox" }).isVisible(), "unified heading");
  for (const channel of ["All", "Email", "Facebook", "Zalo"]) check(await page.getByRole("link", { name: channel, exact: true }).isVisible(), `${channel} filter`);
  check(await page.getByRole("combobox").first().isVisible(), "account filter");
  check(await page.getByRole("button", { name: /Auto-refresh/ }).isVisible(), "auto refresh control");
  const conversationLinks = page.locator('a[href^="/inbox/all/"]');
  const conversationCount = await conversationLinks.count();
  if (conversationCount === 0) {
    const safeCategory = await page.getByText("Inbox could not be loaded.", { exact: false }).count() > 0 ? "ACCOUNT_CONTEXT_UNAVAILABLE"
      : await page.getByText("Omnichannel Inbox is not available yet.", { exact: false }).count() > 0 ? "ACCOUNT_QUERY_UNAVAILABLE"
      : await page.getByText("Conversations could not be loaded.", { exact: false }).count() > 0 ? "QUERY_UNAVAILABLE"
        : await page.getByText("No conversations yet", { exact: true }).count() > 0 ? "EMPTY" : "UNKNOWN";
    throw new Error(`No conversation rows: ${safeCategory}`);
  }
  check(conversationCount > 0, "conversation rows");
  await Promise.all([page.waitForURL((url) => url.pathname.startsWith("/inbox/all/")), conversationLinks.first().click()]);
  check(page.url().includes("/inbox/all/"), "master detail navigation");
  check((await page.locator("main").last().innerText()).includes("synchronized message"), "selected timeline loaded");
  await Promise.all([page.waitForURL((url) => url.searchParams.get("channel") === "EMAIL"), page.getByRole("link", { name: "Email", exact: true }).click()]);
  check(page.url().includes("channel=EMAIL"), "Email filter navigation");
  const emailRows = page.locator('a[href^="/inbox/all/"]');
  if (await emailRows.count() > 0) {
    await Promise.all([page.waitForURL((url) => url.pathname.startsWith("/inbox/all/")), emailRows.first().click()]);
    check((await page.locator("main").last().innerText()).includes("synchronized message"), "email thread detail loaded");
    check((await page.locator("main").last().innerText()).includes("To:"), "email address and body context retained");
  }
  const zaloTab = page.getByRole("link", { name: "Zalo", exact: true });
  await Promise.all([page.waitForURL((url) => url.searchParams.get("channel") === "ZALO"), zaloTab.click()]);
  check(page.url().includes("channel=ZALO"), "Zalo filter navigation");
  const zaloRows = page.locator('a[href^="/inbox/all/"]');
  if (await zaloRows.count() > 0) {
    await Promise.all([page.waitForURL((url) => url.pathname.startsWith("/inbox/all/")), zaloRows.first().click()]);
    check(await page.getByRole("button", { name: "Propose", exact: true }).isVisible(), "reviewed Zalo draft composer visible");
    check((await page.getByRole("button", { name: "Send", exact: true }).count()) === 0, "no direct Zalo Send control");
  }
  await context.close();
  console.log(`OMNICHANNEL_INBOX_BROWSER_PASS assertions=${assertions}`);
} finally {
  await browser.close();
}
