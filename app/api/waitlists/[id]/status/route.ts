import { WaitlistError, rank, referralLink } from "@/lib/core";
import { readLedger } from "@/lib/store";
import { CORS, checkId, fail, json, originOf } from "@/lib/http";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    checkId(id);
    const key = new URL(req.url).searchParams.get("key") || "";
    if (!/^[a-z0-9]{20}$/.test(key)) throw new WaitlistError("not_found", "We couldn't find that signup.", 404);
    const stored = await readLedger(id);
    if (!stored) throw new WaitlistError("not_found", "Waitlist not found.", 404);
    const l = stored.ledger;
    const s = l.signups.find((x) => x.k === key);
    if (!s || s.s === "removed") throw new WaitlistError("not_found", "We couldn't find that signup.", 404);
    const r = rank(l);
    const row = r.byCode.get(s.c)!;
    return json(
      {
        ok: true,
        status: row.status,
        position: row.position,
        total: l.settings.hideCount ? null : r.total,
        waiting: r.waiting,
        referrals: row.referrals,
        pointsPerReferral: l.settings.pointsPerReferral,
        referralCode: row.code,
        referralLink: referralLink(l, row.code, originOf(req)),
      },
      200,
      CORS,
    );
  } catch (e) {
    return fail(e, CORS);
  }
}
