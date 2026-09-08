#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { validateLocalSupabaseEnvironment } from "./validate-phase51-local-environment.mjs";

if (!validateLocalSupabaseEnvironment(process.env)) throw new Error("LOCAL_STORAGE_CONFIG_REJECTED");
const url=process.env.SUPABASE_URL,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY,anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if(!serviceKey||!anonKey)throw new Error("LOCAL_STORAGE_CONFIG_REJECTED");
const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}}),anon=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
let assertions=0;const ok=(value,message)=>{assertions++;if(!value)throw new Error(message)};
const {data:bucket,error:bucketError}=await admin.storage.getBucket("email-attachments");ok(!bucketError&&bucket?.public===false,"PRIVATE_BUCKET_REQUIRED");
const {data:row,error:rowError}=await admin.from("email_attachments").select("storage_bucket,storage_path,sha256").eq("id","95000000-0000-4000-8000-000000000006").single();ok(!rowError&&row,"FIXTURE_ATTACHMENT_REQUIRED");
const unauthenticated=await anon.storage.from(row.storage_bucket).download(row.storage_path);ok(Boolean(unauthenticated.error),"UNAUTHENTICATED_READ_MUST_FAIL");
const authorized=await admin.storage.from(row.storage_bucket).download(row.storage_path);ok(!authorized.error&&authorized.data,"SERVER_BOUNDARY_DOWNLOAD_REQUIRED");const bytes=Buffer.from(await authorized.data.arrayBuffer());ok(createHash("sha256").update(bytes).digest("hex")===row.sha256,"SHA256_MUST_MATCH");
console.log(`PHASE51_LOCAL_STORAGE_PASS assertions=${assertions}`);
