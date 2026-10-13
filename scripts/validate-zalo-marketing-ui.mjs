import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const form = read("src/modules/channels/components/new-channel-campaign-form.tsx");
const data = read("src/modules/channels/server/get-channel-campaign-data.ts");
const actions = read("src/modules/channels/server/channel-campaign-actions.ts");
const detail = read("src/app/(crm)/campaigns/omnichannel/[campaignId]/page.tsx");
let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };

check(form.includes('name="channels" value="ZALO"'), "campaign is locked to Zalo");
check(form.includes('marketing_consent_status === "OPTED_IN"'), "audience requires marketing opt-in");
check(form.includes('readXlsxFile') && form.includes('accept=".xlsx,.csv,.txt'), "phone audience files support XLSX, CSV, and TXT");
check(form.includes("normalizeVietnamPhone") && form.includes("contactsByPhone"), "Vietnam phone numbers are normalized and matched to eligible CRM contacts");
check(form.includes('name="phoneRecipients"') && form.includes("chờ tra cứu khi chạy"), "unresolved phone numbers are persisted for run-time lookup");
check(!form.includes("confirmImportedZaloMarketingConsent") && !form.includes('name="consentConfirmation"'), "phone upload has no separate consent form");
check(actions.includes('marketing_consent_source: "CAMPAIGN_LAUNCH_CONFIRMATION"') && actions.includes('marketing_consent_recorded_at: new Date().toISOString()'), "the explicit campaign launch records consent evidence");
check(form.includes('name="senderIds"') && form.includes('name="contactIds"'), "sender and audience are explicitly selected");
check(form.includes("Tạo bản nháp để xem lại") && form.includes("không gửi ngay"), "draft-first review is explicit");
check(data.includes('.eq("channel_type", "ZALO")'), "only Zalo senders and identities are loaded");
check(data.includes("getAccessibleChannelAccountIds"), "sender accounts respect RBAC scope");
check(data.includes('.contains("allowed_channels", ["ZALO"])'), "Zalo campaign list excludes other channels");
check(actions.includes('hasPermission("campaigns.create")') && actions.includes('hasPermission("campaigns.launch")'), "create and launch permissions are enforced");
check(detail.includes("ConfirmSubmitButton") && detail.includes("Xác nhận và chạy chiến dịch"), "launch requires an explicit confirmation");
check(detail.includes("Không tìm thấy Zalo") && detail.includes("Tra cứu Zalo thất bại"), "recipient lookup outcomes are visible on the review page");

console.log(`ZALO_MARKETING_UI_PASS assertions=${assertions}`);
