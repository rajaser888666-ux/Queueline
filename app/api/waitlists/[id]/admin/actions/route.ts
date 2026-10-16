import { WaitlistError, applyAdminAction, topWaiting, type AdminAction } from "@/lib/core";
import { mutateLedger } from "@/lib/store";
import { checkId, fail, json, readBody, tokenFrom, verifyAdmin } from "@/lib/http";

export const dynamic = "force-dynamic";
const ACTIONS: AdminAction[] = ["admit", "unadmit", "remove", "restore"];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    checkId(id);
    const token = tokenFrom(req);
    const body = await readBody(req, 64_000);
    const action = body.action as AdminAction;
    if (!ACTIONS.includes(action)) throw new WaitlistError("action_invalid", "Unknown action.");
    const top = body.top === undefined ? null : Number(body.top);
    if (top !== null && (!Number.isInteger(top) || top < 1 || top > 1000)) throw new WaitlistError("top_invalid", "Choose between 1 and 1000 people.");
    if (top !== null && action !== "admit") throw new WaitlistError("action_invalid", "Only admit works with a count.");
    const codes = Array.isArray(body.codes) ? body.codes.filter((c): c is string => typeof c === "string").slice(0, 1000) : [];
    if (top === null && codes.length === 0) throw new WaitlistError("codes_required", "Pick at least one person.");
    const { result } = await mutateLedger(id, (l) => {
      verifyAdmin(l, token);
      const target = top !== null ? topWaiting(l, top) : codes;
      return { changed: applyAdminAction(l, action, target, Date.now()), codes: target };
    });
    return json({ ok: true, ...result });
  } catch (e) {
    return fail(e);
  }
}
