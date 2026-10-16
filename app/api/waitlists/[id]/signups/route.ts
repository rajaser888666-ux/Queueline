import { WaitlistError, addSignup, randomId, rank, referralLink, type SignupSource } from "@/lib/core";
import { mutateLedger } from "@/lib/store";
import { CORS, burstLimit, checkId, clientIp, fail, ipHash, json, originOf, readBody } from "@/lib/http";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

const SOURCES: SignupSource[] = ["hosted", "widget", "api"];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    checkId(id);
    const ip = clientIp(req);
    burstLimit("signup:" + ip, 12, 60_000);
    const body = await readBody(req);

    // Bot traps: a hidden field humans never fill, and a minimum time on the form.
    const elapsed = typeof body.elapsed === "number" ? body.elapsed : Number(body.elapsed);
    if (typeof body.website === "string" && body.website.length > 0) {
      // Honeypot filled: pretend it worked so the bot learns nothing.
      return json({ ok: true, position: null, total: null, referralLink: null, message: "Thanks!" }, 200, CORS);
    }
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 600) {
      // Submitted faster than a person can type. Real people (autofill) just press the button again.
      throw new WaitlistError("too_fast", "That was quick! Press the button again to confirm.", 400);
    }

    const source = SOURCES.includes(body.source as SignupSource) ? (body.source as SignupSource) : "api";
    const { ledger, result } = await mutateLedger(id, (l) =>
      addSignup(l, { email: body.email, ref: body.ref, ipHash: ipHash(ip, id), now: Date.now(), source, newCode: () => randomId(8), newKey: () => randomId(20) }),
    );
    const r = rank(ledger);
    const row = r.byCode.get(result.signup.c)!;
    const origin = originOf(req);
    return json(
      {
        ok: true,
        existing: result.existing,
        status: row.status,
        position: row.position,
        total: ledger.settings.hideCount ? null : r.total,
        waiting: r.waiting,
        referrals: row.referrals,
        pointsPerReferral: ledger.settings.pointsPerReferral,
        referralCode: row.code,
        referralLink: referralLink(ledger, row.code, origin),
        // The private status key is only handed out on first signup.
        statusKey: result.existing ? null : result.signup.k,
        statusUrl: result.existing ? null : `${origin}/w/${id}?me=${result.signup.k}`,
      },
      result.existing ? 200 : 201,
      CORS,
    );
  } catch (e) {
    return fail(e, CORS);
  }
}
