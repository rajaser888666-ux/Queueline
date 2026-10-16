import { DEFAULT_SETTINGS, WaitlistError, cleanText, randomId, sanitizeSettings, validateEmail, validateName, LIMITS, type Ledger } from "@/lib/core";
import { createLedger } from "@/lib/store";
import { burstLimit, clientIp, fail, json, originOf, readBody, sha256 } from "@/lib/http";
import { ConflictError } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    burstLimit("create:" + clientIp(req), 10, 3600_000);
    const body = await readBody(req);
    if (body.website) throw new WaitlistError("rejected", "Request rejected.", 400); // honeypot
    const name = validateName(body.name);
    let ownerEmail: string;
    try {
      ownerEmail = validateEmail(body.ownerEmail);
    } catch (e) {
      throw new WaitlistError("owner_email_invalid", "Enter your own email so you can recognise this waitlist later.");
    }
    const settings = sanitizeSettings(
      { pointsPerReferral: body.pointsPerReferral ?? DEFAULT_SETTINGS.pointsPerReferral, shareUrl: body.shareUrl ?? null },
      DEFAULT_SETTINGS,
    );
    const adminToken = randomId(32);
    const now = Date.now();
    let ledger: Ledger | null = null;
    for (let i = 0; i < 4 && !ledger; i++) {
      const candidate: Ledger = {
        v: 1,
        id: randomId(10),
        name,
        description: cleanText(body.description, LIMITS.descriptionMax),
        ownerEmail,
        adminHash: sha256(adminToken),
        createdAt: now,
        settings,
        signups: [],
      };
      try {
        await createLedger(candidate);
        ledger = candidate;
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }
    if (!ledger) throw new WaitlistError("busy", "Please try again.", 503);
    const origin = originOf(req);
    return json(
      {
        id: ledger.id,
        name: ledger.name,
        adminToken,
        adminUrl: `${origin}/admin/${ledger.id}#k=${adminToken}`,
        hostedUrl: `${origin}/w/${ledger.id}`,
        embedSnippet: `<script src="${origin}/embed.js" data-waitlist="${ledger.id}" async></script>`,
      },
      201,
    );
  } catch (e) {
    return fail(e);
  }
}
