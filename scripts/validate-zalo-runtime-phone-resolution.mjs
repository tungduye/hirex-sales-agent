import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const form = read("src/modules/channels/components/new-channel-campaign-form.tsx");
const actions = read("src/modules/channels/server/channel-campaign-actions.ts");
const worker = read("src/modules/channels/server/process-channel-campaign-batch.ts");
const adapter = read("src/modules/channels/adapters/zalo/zalo-bridge-adapter.ts");
const projection = read("src/modules/channels/server/project-channel-campaign.ts");
let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };

check(form.includes('name="phoneRecipients"'), "draft submits unresolved phone recipients");
check(!form.includes('name="phoneConsentSource"') && !form.includes('name="phoneConsentConfirmation"'), "phone import has no separate consent form");
check(actions.includes("ZALO_CAMPAIGN_PHONE_IMPORT"), "draft persists phone-only recipients");
check(actions.includes('hasPermission("contacts.create")') && actions.includes('hasPermission("contacts.update")'), "phone import is permission guarded");
check(actions.includes('marketing_consent_source: "CAMPAIGN_LAUNCH_CONFIRMATION"'), "launch confirmation records campaign consent evidence");
check(worker.includes("resolvePendingZaloPhones"), "worker resolves phones at execution time");
check(worker.includes('findUserByPhone(`+84${phoneEvidence.phone.slice(1)}`'), "worker uses the Zalo lookup bridge");
check(worker.includes('stop_reason:"ZALO_NOT_FOUND"') && worker.includes('safe_error_code:"ZALO_NOT_FOUND"'), "not-found outcome is durable");
check(worker.includes('stop_reason:"ZALO_LOOKUP_FAILED"') && worker.includes('safe_error_code:"ZALO_LOOKUP_FAILED"'), "lookup failure outcome is durable");
check(worker.includes('!(error instanceof ChannelError)||error.retryable'), "only explicit non-retryable provider errors are terminal");
check(worker.includes('.lte("next_step_at",now.toISOString())'), "deferred recipients are only retried when due");
check(worker.includes('deferred+=1') && worker.includes('deferred:resolution.deferred'), "deferred lookup count is returned safely");
check(adapter.includes('if (response.status === 429) throw new ChannelError("RATE_LIMITED", true)'), "Zalo rate limits are retryable");
check(adapter.includes('new ChannelError("ACCOUNT_UNAVAILABLE", response.status >= 500)'), "Zalo server errors are retryable");
check(adapter.includes('catch {\n      throw new ChannelError("ACCOUNT_UNAVAILABLE", true);'), "Zalo transport errors are retryable without leaking details");
check(projection.includes("MAX_FILTER_IDS = 100") && projection.includes("readInBatches(contactIds"), "large contact identity reads are chunked to avoid oversized queries");
check(projection.includes('.in("channel_type",channelTypes)'), "projection only loads identities for channels used by the campaign");
check(projection.includes("facebookAccountIds.length ? readPaged((from,to)=>db.from(\"omnichannel_conversations\")"), "non-Facebook campaigns avoid irrelevant conversation scans");
check(projection.includes("PAGE_SIZE = 500") && projection.includes("range(from,to)"), "projection pages through campaign audiences larger than the API row cap");
check(worker.includes('marketing_consent_status:"OPTED_IN"') && worker.includes("phoneEvidence.source"), "resolved Zalo identity inherits explicit consent evidence");
check(worker.indexOf("resolvePendingZaloPhones") < worker.indexOf("projectChannelCampaign({workspaceId"), "resolution runs before delivery projection");

console.log(`ZALO_RUNTIME_PHONE_RESOLUTION_PASS assertions=${assertions}`);
