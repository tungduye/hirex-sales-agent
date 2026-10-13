import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"..");
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
let assertions=0;
const has=(text,value)=>{assert.ok(text.includes(value),`missing ${value}`);assertions++};

const migration=read("supabase/migrations/027_campaign_marketing_metadata.sql");
for(const value of ["combo_uv text","placement text","channel_rank text","owner_name text","char_length(combo_uv) <= 200","char_length(owner_name) <= 200"])has(migration,value);

const action=read("src/modules/campaigns/server/campaign-actions.ts");
for(const value of ["comboUv:formData.get(\"comboUv\")","placement:formData.get(\"placement\")","channelRank:formData.get(\"channelRank\")","ownerName:formData.get(\"ownerName\")","combo_uv:parsed.comboUv","owner_name:parsed.ownerName"])has(action,value);

const wizard=read("src/app/(crm)/campaigns/new/page.tsx");
for(const value of ["Combo UV","Vị trí","Xếp hạng kênh","Owner","name=\"comboUv\"","name=\"ownerName\""])has(wizard,value);

const list=read("src/app/(crm)/campaigns/page.tsx");
for(const value of ["Tên chiến dịch","Ngày bắt đầu","Số lượng","Email gửi đi","Xuất ALL Output","c.senderEmails.join"])has(list,value);

const exportSource=read("src/modules/campaigns/server/all-campaign-report-export.ts");
for(const value of ["Tổng hợp chiến dịch","c.startedAt","c.sent","c.comboUv","c.placement","c.channelRank","c.ownerName","c.senderEmails.join"])has(exportSource,value);

const detail=read("src/app/(crm)/campaigns/[campaignId]/page.tsx");
for(const value of ["Số lượng email đã gửi","Nguồn gửi đi","row.combo_uv","row.channel_rank","row.owner_name"])has(detail,value);

console.log(`EMAIL_MARKETING_COLUMNS_PASS assertions=${assertions}`);
