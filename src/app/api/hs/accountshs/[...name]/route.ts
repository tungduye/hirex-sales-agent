import { handleGet, handlePost } from "../../../../../../moduleHS/accountshs/server/handler";

// AccountsHS (moduleHS): mọi API của v7.py cũ nằm dưới /api/hs/accountshs/<name>. Logic ở moduleHS/accountshs/server/handler.ts.
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ name: string[] }> };

export async function GET(req: Request, ctx: Ctx) {
  const { name } = await ctx.params;
  return handleGet(name.join("/"), new URL(req.url).searchParams, req);
}
export async function POST(req: Request, ctx: Ctx) {
  const { name } = await ctx.params;
  return handlePost(name.join("/"), new URL(req.url).searchParams, req);
}
