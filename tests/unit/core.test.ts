import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS, LIMITS, WaitlistError, addSignup, applyAdminAction, cleanText, dailySignups, isId, maskEmail, normalizeEmail,
  publicInfo, randomId, rank, referralCounts, referralLink, sanitizeSettings, toCsv, topWaiting, validateEmail, validateName,
  validatePoints, validateShareUrl, type Ledger, type Signup,
} from "@/lib/core";

let seq = 0;
const code = () => "c" + String(++seq).padStart(7, "0");
const key = () => "k" + String(seq).padStart(19, "0");

function ledger(over: Partial<Ledger> = {}): Ledger {
  return { v: 1, id: "abcdefghjk", name: "Test", description: "", ownerEmail: "o@x.com", adminHash: "h", createdAt: 0, settings: { ...DEFAULT_SETTINGS }, signups: [], ...over };
}
function join(l: Ledger, email: string, opts: { ref?: string | null; ip?: string; at?: number } = {}) {
  return addSignup(l, { email, ref: opts.ref ?? null, ipHash: opts.ip ?? "ip-" + email, now: opts.at ?? 1_000_000 + l.signups.length * 1000, source: "api", newCode: code, newKey: key });
}
const expectErr = (fn: () => unknown, codeName: string) => {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(WaitlistError); expect((e as WaitlistError).code).toBe(codeName); return; }
  throw new Error("expected error " + codeName);
};

describe("email validation", () => {
  it("normalises case and whitespace", () => expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com"));
  it("accepts ordinary addresses incl. plus and subdomains", () => {
    expect(validateEmail("a.b+tag@mail.example.co.uk")).toBe("a.b+tag@mail.example.co.uk");
  });
  it.each(["", "plain", "a@b", "a@b.c", "a@@b.com", "a b@c.com", "a@-b.com", "a@b..com", "a@b.123"])("rejects %j", (bad) => {
    expect(() => validateEmail(bad)).toThrow(WaitlistError);
  });
  it("rejects non-strings", () => expectErr(() => validateEmail(42), "email_required"));
  it("rejects over-long addresses", () => expectErr(() => validateEmail("a".repeat(250) + "@x.com"), "email_invalid"));
  it("rejects disposable domains", () => expectErr(() => validateEmail("x@mailinator.com"), "email_disposable"));
});

describe("other validation", () => {
  it("name needs 2+ chars and is trimmed/clipped", () => {
    expectErr(() => validateName(" a "), "name_invalid");
    expect(validateName("  My   app ")).toBe("My app");
    expect(validateName("x".repeat(200)).length).toBe(LIMITS.nameMax);
  });
  it("cleanText strips control characters", () => expect(cleanText("a\u0000b\nc", 10)).toBe("a b c"));
  it("share URL must be http(s), drops hash and ref", () => {
    expect(validateShareUrl("https://acme.com/launch?ref=old&utm=1#top")).toBe("https://acme.com/launch?utm=1");
    expect(validateShareUrl("")).toBeNull();
    expectErr(() => validateShareUrl("javascript:alert(1)"), "share_url_invalid");
    expectErr(() => validateShareUrl("acme.com"), "share_url_invalid");
  });
  it("points must be an integer in range", () => {
    expect(validatePoints(0)).toBe(0);
    expect(validatePoints("7")).toBe(7);
    expectErr(() => validatePoints(-1), "points_invalid");
    expectErr(() => validatePoints(2.5), "points_invalid");
    expectErr(() => validatePoints(1001), "points_invalid");
  });
  it("sanitizeSettings merges onto base", () => {
    const s = sanitizeSettings({ pointsPerReferral: 2, hideCount: 1 }, DEFAULT_SETTINGS);
    expect(s).toEqual({ ...DEFAULT_SETTINGS, pointsPerReferral: 2, hideCount: true });
  });
});

describe("ids", () => {
  it("randomId has the right length and alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const id = randomId(12);
      expect(id).toMatch(/^[a-hj-km-np-z2-9]{12}$/);
    }
  });
  it("randomId is not trivially repeating", () => expect(new Set(Array.from({ length: 200 }, () => randomId(8))).size).toBe(200));
  it("isId bounds", () => {
    expect(isId("abc123")).toBe(true);
    expect(isId("ABC123")).toBe(false);
    expect(isId("ab")).toBe(false);
    expect(isId("../etc")).toBe(false);
  });
});

describe("signup + dedupe", () => {
  it("adds a waiting signup with code and key", () => {
    const l = ledger();
    const r = join(l, "Ada@x.com");
    expect(r.existing).toBe(false);
    expect(r.signup).toMatchObject({ e: "ada@x.com", s: "waiting", r: null });
    expect(l.signups).toHaveLength(1);
  });
  it("dedupes by normalised email and returns the original", () => {
    const l = ledger();
    const a = join(l, "ada@x.com");
    const b = join(l, "  ADA@x.com ");
    expect(b.existing).toBe(true);
    expect(b.signup.c).toBe(a.signup.c);
    expect(l.signups).toHaveLength(1);
  });
  it("removed emails cannot rejoin", () => {
    const l = ledger();
    const a = join(l, "ada@x.com");
    applyAdminAction(l, "remove", [a.signup.c], 5);
    expectErr(() => join(l, "ada@x.com"), "signup_closed");
  });
  it("ignores unknown referral codes", () => {
    const l = ledger();
    expect(join(l, "a@x.com", { ref: "nope" }).signup.r).toBeNull();
  });
  it("accepts referral codes case-insensitively", () => {
    const l = ledger();
    const a = join(l, "a@x.com");
    expect(join(l, "b@x.com", { ref: a.signup.c.toUpperCase() }).signup.r).toBe(a.signup.c);
  });
  it("caps signups per IP per hour", () => {
    const l = ledger();
    for (let i = 0; i < LIMITS.perIpPerHour; i++) join(l, `u${i}@x.com`, { ip: "same", at: 10_000 + i });
    expectErr(() => join(l, "late@x.com", { ip: "same", at: 20_000 }), "rate_limited");
    // an hour later the window has passed
    expect(join(l, "later@x.com", { ip: "same", at: 10_000 + 3600_001 }).existing).toBe(false);
  });
  it("refuses when the waitlist is full", () => {
    const l = ledger();
    l.signups = Array.from({ length: LIMITS.maxSignups }, (_, i) => ({ e: `${i}@x.com`, c: `c${i}`, k: "k", r: null, ip: `i${i}`, at: i, s: "waiting", src: "api" }) as Signup);
    expectErr(() => join(l, "new@x.com"), "waitlist_full");
  });
  it("regenerates a colliding code", () => {
    const l = ledger();
    const codes = ["dupe0000", "dupe0000", "fresh000"];
    addSignup(l, { email: "a@x.com", ipHash: "1", now: 1, source: "api", newCode: () => "dupe0000", newKey: key });
    const r = addSignup(l, { email: "b@x.com", ipHash: "2", now: 2, source: "api", newCode: () => codes.shift()!, newKey: key });
    expect(r.signup.c).toBe("fresh000");
  });
});

describe("ranking and referral scoring", () => {
  it("orders by join time without referrals", () => {
    const l = ledger();
    ["a", "b", "c"].forEach((n) => join(l, `${n}@x.com`));
    expect(rank(l).rows.map((r) => [r.email, r.position])).toEqual([["a@x.com", 1], ["b@x.com", 2], ["c@x.com", 3]]);
  });
  it("each referral moves the referrer up N spots", () => {
    const l = ledger();
    l.settings.pointsPerReferral = 2;
    for (let i = 1; i <= 6; i++) join(l, `p${i}@x.com`);
    const p6 = l.signups[5].c;
    join(l, "f1@x.com", { ref: p6 }); // p6 score 6-2 = 4 → ties with p4, p4 joined first
    let r = rank(l);
    expect(r.byCode.get(p6)!.referrals).toBe(1);
    expect(r.byCode.get(p6)!.position).toBe(5);
    join(l, "f2@x.com", { ref: p6 }); // score 6-4 = 2 → behind p2 (tie, p2 earlier)
    r = rank(l);
    expect(r.byCode.get(p6)!.position).toBe(3);
  });
  it("position never goes below 1 and ties go to the earliest joiner", () => {
    const l = ledger();
    l.settings.pointsPerReferral = 100;
    join(l, "a@x.com");
    const b = join(l, "b@x.com").signup;
    join(l, "c@x.com", { ref: b.c });
    const r = rank(l);
    expect(r.byCode.get(b.c)!.position).toBe(1);
    expect(r.rows[0].email).toBe("b@x.com");
  });
  it("0 points per referral keeps pure join order", () => {
    const l = ledger();
    l.settings.pointsPerReferral = 0;
    join(l, "a@x.com");
    const b = join(l, "b@x.com").signup;
    join(l, "c@x.com", { ref: b.c });
    expect(rank(l).byCode.get(b.c)!.position).toBe(2);
    expect(rank(l).byCode.get(b.c)!.referrals).toBe(1);
  });
  it("referrals from the referrer's own IP don't count", () => {
    const l = ledger();
    const a = join(l, "a@x.com", { ip: "home" }).signup;
    join(l, "a2@x.com", { ref: a.c, ip: "home" });
    join(l, "friend@x.com", { ref: a.c, ip: "elsewhere" });
    expect(referralCounts(l.signups).get(a.c)).toBe(1);
  });
  it("removed referees stop counting; admitted referees still count", () => {
    const l = ledger();
    const a = join(l, "a@x.com").signup;
    const f1 = join(l, "f1@x.com", { ref: a.c }).signup;
    const f2 = join(l, "f2@x.com", { ref: a.c }).signup;
    applyAdminAction(l, "remove", [f1.c], 1);
    applyAdminAction(l, "admit", [f2.c], 1);
    expect(rank(l).byCode.get(a.c)!.referrals).toBe(1);
  });
  it("admitted and removed people leave the line and others move up", () => {
    const l = ledger();
    const [a, b, c] = ["a", "b", "c"].map((n) => join(l, `${n}@x.com`).signup);
    applyAdminAction(l, "admit", [a.c], 10);
    applyAdminAction(l, "remove", [b.c], 11);
    const r = rank(l);
    expect(r.byCode.get(c.c)!.position).toBe(1);
    expect(r.byCode.get(a.c)!.position).toBeNull();
    expect([r.waiting, r.admitted, r.removed, r.total]).toEqual([1, 1, 1, 2]);
    expect(r.rows.map((x) => x.status)).toEqual(["waiting", "admitted", "removed"]);
  });
  it("uses commit order, not client/instance timestamps, for join order", () => {
    const l = ledger();
    join(l, "a@x.com", { at: 5000 });
    join(l, "b@x.com", { at: 1000 }); // clock skew: committed second, stamped earlier
    expect(rank(l).rows.map((r) => r.email)).toEqual(["a@x.com", "b@x.com"]);
  });
  it("totals count valid referrals", () => {
    const l = ledger();
    const a = join(l, "a@x.com").signup;
    join(l, "b@x.com", { ref: a.c });
    join(l, "c@x.com", { ref: a.c });
    expect(rank(l).totalReferrals).toBe(2);
  });
});

describe("admin actions", () => {
  it("admit/unadmit/remove/restore transition only from valid states", () => {
    const l = ledger();
    const a = join(l, "a@x.com").signup;
    expect(applyAdminAction(l, "unadmit", [a.c], 1)).toBe(0);
    expect(applyAdminAction(l, "admit", [a.c], 2)).toBe(1);
    expect(applyAdminAction(l, "admit", [a.c], 3)).toBe(0);
    expect(l.signups[0].sa).toBe(2);
    expect(applyAdminAction(l, "unadmit", [a.c], 4)).toBe(1);
    expect(applyAdminAction(l, "remove", [a.c], 5)).toBe(1);
    expect(applyAdminAction(l, "restore", [a.c], 6)).toBe(1);
    expect(l.signups[0].s).toBe("waiting");
  });
  it("topWaiting follows line order including referral credit", () => {
    const l = ledger();
    l.settings.pointsPerReferral = 10;
    join(l, "a@x.com");
    join(l, "b@x.com");
    const c = join(l, "c@x.com").signup;
    join(l, "d@x.com", { ref: c.c });
    expect(topWaiting(l, 2).map((x) => l.signups.find((s) => s.c === x)!.e)).toEqual(["c@x.com", "a@x.com"]);
    expect(topWaiting(l, 0)).toEqual([]);
  });
});

describe("presentation", () => {
  it("masks emails", () => {
    expect(maskEmail("jonathan@gmail.com")).toBe("j****n@g***.com");
    expect(maskEmail("al@x.io")).toBe("a*@x***.io");
  });
  it("referral link uses share URL when set, otherwise the hosted page", () => {
    const l = ledger();
    expect(referralLink(l, "abc", "https://q.app")).toBe("https://q.app/w/abcdefghjk?ref=abc");
    l.settings.shareUrl = "https://acme.com/?utm=x";
    expect(referralLink(l, "abc", "https://q.app")).toBe("https://acme.com/?utm=x&ref=abc");
  });
  it("CSV has header, rows in line order, escaping and formula guard", () => {
    const l = ledger();
    const a = join(l, "a@x.com").signup;
    join(l, "=cmd@x.com", { ref: a.c });
    l.name = 'He said "hi"';
    const csv = toCsv(l, "https://q.app");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("position,email,status,referrals,referral_code,referral_link,referred_by,joined_at,status_changed_at,source");
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith("1,a@x.com,waiting,1,")).toBe(true);
    expect(lines[2]).toContain(",'=cmd@x.com,");
    expect(lines[2]).toContain(`,${a.c},`);
  });
  it("dailySignups buckets by UTC day and excludes removed", () => {
    const now = Date.UTC(2026, 9, 11, 12);
    const l = ledger();
    join(l, "a@x.com", { at: now - 1000 });
    join(l, "b@x.com", { at: now - 86400_000 });
    const c = join(l, "c@x.com", { at: now - 2000 }).signup;
    applyAdminAction(l, "remove", [c.c], now);
    const d = dailySignups(l, now, 3);
    expect(d).toEqual([{ day: "2026-10-09", count: 0 }, { day: "2026-10-10", count: 1 }, { day: "2026-10-11", count: 1 }]);
  });
  it("publicInfo hides counts and leaderboard per settings and never exposes raw emails", () => {
    const l = ledger();
    const a = join(l, "alice@example.com").signup;
    join(l, "bob@example.com", { ref: a.c });
    let p = publicInfo(l);
    expect(p.count).toBe(2);
    expect(p.leaderboard).toEqual([{ who: "a***e@e***.com", referrals: 1 }]);
    expect(JSON.stringify(p)).not.toContain("alice@");
    l.settings.hideCount = true;
    l.settings.showLeaderboard = false;
    p = publicInfo(l);
    expect(p.count).toBeNull();
    expect(p.leaderboard).toEqual([]);
  });
});
