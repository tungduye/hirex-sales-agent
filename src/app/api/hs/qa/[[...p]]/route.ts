import { handle } from "../../../../../../moduleHS/qa/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }
