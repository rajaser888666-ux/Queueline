import { WaitlistError, cleanText, dailySignups, rank, referralLink, sanitizeSettings, validateName, LIMITS } from "@/lib/core";
import { mutateLedger } from "@/lib/store";
import { checkId, fail, json, loadAdmin, originOf, readBody, tokenFrom, verifyAdmin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const l = await loadAdmin(req, id);
    const r = rank(l);
    const origin = originOf(req);
    return json({
      id: l.id,
      name: l.name,
      description: l.description,
      ownerEmail: l.ownerEmail,
      createdAt: l.createdAt,
      settings: l.settings,
      hostedUrl: `${origin}/w/${l.id}`,
      embedSnippet: `<script src="${origin}/embed.js" data-waitlist="${l.id}" async></script>`,
      stats: { total: r.total, waiting: r.waiting, admitted: r.admitted, removed: r.removed, referrals: r.totalReferrals },
      daily: dailySignups(l, Date.now(), 14),
      rows: r.rows.map((x) => ({ ...x, referralLink: referralLink(l, x.code, origin) })),
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    checkId(id);
    const token = tokenFrom(req);
    const body = await readBody(req);
    const { ledger } = await mutateLedger(id, (l) => {
      verifyAdmin(l, token);
      if (body.name !== undefined) l.name = validateName(body.name);
      if (body.description !== undefined) l.description = cleanText(body.description, LIMITS.descriptionMax);
      if (body.settings !== undefined) {
        if (!body.settings || typeof body.settings !== "object") throw new WaitlistError("settings_invalid", "Settings must be an object.");
        l.settings = sanitizeSettings(body.settings as Record<string, unknown>, l.settings);
      }
    });
    return json({ ok: true, name: ledger.name, description: ledger.description, settings: ledger.settings });
  } catch (e) {
    return fail(e);
  }
}
