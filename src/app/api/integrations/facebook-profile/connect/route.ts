import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/modules/access/server/access-control";

export const runtime = "nodejs";
const inputSchema=z.object({displayName:z.string().trim().min(1).max(160)});
const jobSchema=z.string().uuid();
function sameOrigin(request:NextRequest){const origin=request.headers.get("origin"),host=request.headers.get("x-forwarded-host")??request.headers.get("host"),protocol=request.headers.get("x-forwarded-proto")??request.nextUrl.protocol.replace(":","");return !origin||Boolean(host&&origin===`${protocol}://${host}`)}

export async function POST(request:NextRequest){
  if(!sameOrigin(request))return NextResponse.json({error:"FORBIDDEN"},{status:403});
  try{await requirePermission("channels.manage")}catch{return NextResponse.json({error:"FORBIDDEN"},{status:403})}
  let body:unknown;try{body=await request.json()}catch{return NextResponse.json({error:"INVALID_INPUT"},{status:400})}
  const parsed=inputSchema.safeParse(body);if(!parsed.success)return NextResponse.json({error:"INVALID_INPUT"},{status:400});
  const jobId=randomUUID();
  const child=spawn(process.execPath,["--env-file=.env.local",resolve("scripts/onboard-facebook-profile.mjs")],{cwd:process.cwd(),env:{...process.env,HIREX_FB_PROFILE_SLOT:jobId,HIREX_FB_PROFILE_DISPLAY_NAME:parsed.data.displayName},detached:true,stdio:"ignore",windowsHide:true});
  child.unref();
  return NextResponse.json({jobId},{status:202,headers:{"cache-control":"no-store"}});
}

export async function GET(request:NextRequest){
  try{await requirePermission("channels.manage")}catch{return NextResponse.json({error:"FORBIDDEN"},{status:403})}
  const jobId=request.nextUrl.searchParams.get("jobId");if(!jobId||!jobSchema.safeParse(jobId).success)return NextResponse.json({error:"INVALID_INPUT"},{status:400});
  try{return NextResponse.json(JSON.parse(await readFile(resolve("runtime/facebook-profile-onboarding",`${jobId}.json`),"utf8")),{headers:{"cache-control":"no-store"}})}catch{return NextResponse.json({state:"STARTING",message:"Đang mở cửa sổ đăng nhập Facebook."},{headers:{"cache-control":"no-store"}})}
}
