import { handle } from "../../../../../../moduleHS/record/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ p?: string[] }> };
export async function GET(req: Request, ctx: Ctx) { return handle(req, (await ctx.params).p ?? []); }
export async function POST(req: Request, ctx: Ctx) { return handle(req, (await ctx.params).p ?? []); }
