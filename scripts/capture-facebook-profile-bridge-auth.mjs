import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const slot = process.env.HIREX_FB_PROFILE_SLOT?.trim() || "default";
if (!/^[a-z0-9-]{1,64}$/u.test(slot)) throw new Error("INVALID_FACEBOOK_PROFILE_SLOT");
const suffix = slot === "default" ? "" : `-${slot}`;
const profileDirectory = resolve(`playwright/.auth/facebook-profile-bridge${suffix}`);
const readyFile = resolve(`playwright/.auth/facebook-profile-bridge${suffix}.ready.json`);
const stateFile = resolve(`playwright/.auth/facebook-profile-bridge-state${suffix}.json`);
await mkdir(profileDirectory, { recursive: true });

const context = await chromium.launchPersistentContext(profileDirectory, {
  headless: false,
  viewport: null,
  args: ["--start-maximized"],
});
const page = context.pages()[0] ?? await context.newPage();
await page.goto("https://www.messenger.com/", { waitUntil: "domcontentloaded" });

const deadline = Date.now() + 15 * 60 * 1000;
let authenticated = false;
while (Date.now() < deadline) {
  const cookies = await context.cookies("https://www.facebook.com", "https://www.messenger.com");
  const names = new Set(cookies.map((cookie) => cookie.name));
  if (names.has("c_user") && names.has("xs")) {
    authenticated = true;
    await context.storageState({ path: stateFile });
    await writeFile(readyFile, JSON.stringify({ capturedAt: new Date().toISOString() }, null, 2), "utf8");
    break;
  }
  await page.waitForTimeout(1000);
}

await context.close();
if (!authenticated) process.exitCode = 2;
