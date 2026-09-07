import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadQaRecipientAllowlist } from "./phase4c-qa-recipient-allowlist.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
let emails;
try {
  emails = loadQaRecipientAllowlist(projectRoot).slice(0, 2);
} catch {
  console.error("QA_ALLOWLIST_INVALID");
  process.exit(2);
}

const rows = ["email,name,company,position"];
emails.forEach((email, index) => rows.push(`${email},QA Recipient ${index + 1},HireX QA,QA`));
rows.push(`${emails[0]},Duplicate QA Recipient,HireX QA,QA`);
rows.push("invalid-address,Invalid Recipient,HireX QA,QA");

const runtimeDirectory = resolve(projectRoot, "runtime");
const output = resolve(runtimeDirectory, "phase4c-qa-audience.csv");
await mkdir(runtimeDirectory, { recursive: true });
await writeFile(output, `${rows.join("\r\n")}\r\n`, { encoding: "utf8", mode: 0o600 });
console.log(`QA_AUDIENCE_FILE_READY recipients=${emails.length} sourceRows=${rows.length - 1}`);
