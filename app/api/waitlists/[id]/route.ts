import { WaitlistError, publicInfo } from "@/lib/core";
import { readLedger } from "@/lib/store";
import { CORS, checkId, fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    checkId(id);
    const stored = await readLedger(id, { cached: true });
    if (!stored) throw new WaitlistError("not_found", "Waitlist not found.", 404);
    return json(publicInfo(stored.ledger), 200, CORS);
  } catch (e) {
    return fail(e, CORS);
  }
}
