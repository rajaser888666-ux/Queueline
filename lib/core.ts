// Pure waitlist logic: no I/O. Everything here is unit-tested.

export type SignupStatus = "waiting" | "admitted" | "removed";
export type SignupSource = "hosted" | "widget" | "api" | "seed";

export interface Signup {
  e: string; // normalised email
  c: string; // public referral code
  k: string; // private status key (lets the person check their spot)
  r: string | null; // referral code of the person who referred them
  ip: string; // short salted hash of the IP, used for rate limits and self-referral checks
  at: number; // joined, ms
  s: SignupStatus;
  sa?: number; // status changed at, ms
  src: SignupSource;
}

export interface Settings {
  pointsPerReferral: number; // spots gained per valid referral
  shareUrl: string | null; // where referral links point (creator's landing page); null = hosted page
  showLeaderboard: boolean;
  hideCount: boolean; // hide total-signups count on public surfaces
}

export interface Ledger {
  v: 1;
  id: string;
  name: string;
  description: string;
  ownerEmail: string;
  adminHash: string; // sha256 hex of the admin token
  createdAt: number;
  settings: Settings;
  signups: Signup[];
}

export const DEFAULT_SETTINGS: Settings = {
  pointsPerReferral: 5,
  shareUrl: null,
  showLeaderboard: true,
  hideCount: false,
};

export const LIMITS = {
  nameMax: 80,
  descriptionMax: 280,
  pointsMin: 0,
  pointsMax: 1000,
  maxSignups: 10000,
  perIpPerHour: 5, // signups from one IP into one waitlist per rolling hour
};

export class WaitlistError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// ---------- validation ----------

const EMAIL_RE = /^[^\s@"(),:;<>[\]\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

// A short list of the most common throwaway inbox domains.
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
  "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com",
  "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mailnesia.com", "tempail.com",
  "emailondeck.com", "mintemail.com", "mohmal.com", "discard.email", "burnermail.io",
]);

export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

export function validateEmail(raw: unknown): string {
  const e = normalizeEmail(raw);
  if (!e) throw new WaitlistError("email_required", "Enter your email address.");
  if (e.length > 254 || !EMAIL_RE.test(e)) throw new WaitlistError("email_invalid", "That email address doesn't look right.");
  const domain = e.split("@")[1];
  const tld = domain.split(".").pop() || "";
  if (tld.length < 2 || /^\d+$/.test(tld)) throw new WaitlistError("email_invalid", "That email address doesn't look right.");
  if (DISPOSABLE_DOMAINS.has(domain)) throw new WaitlistError("email_disposable", "Please use a permanent email address.");
  return e;
}

export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  // strip control characters, collapse whitespace
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function validateName(raw: unknown): string {
  const n = cleanText(raw, LIMITS.nameMax);
  if (n.length < 2) throw new WaitlistError("name_invalid", "Give the waitlist a name (at least 2 characters).");
  return n;
}

export function validateShareUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") throw new WaitlistError("share_url_invalid", "Share URL must be a web address.");
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new WaitlistError("share_url_invalid", "Share URL must be a full web address, like https://example.com.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new WaitlistError("share_url_invalid", "Share URL must start with http:// or https://.");
  u.hash = "";
  u.searchParams.delete("ref");
  return u.toString();
}

export function validatePoints(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < LIMITS.pointsMin || n > LIMITS.pointsMax)
    throw new WaitlistError("points_invalid", `Spots per referral must be a whole number from ${LIMITS.pointsMin} to ${LIMITS.pointsMax}.`);
  return n;
}

export function sanitizeSettings(input: Partial<Record<keyof Settings, unknown>>, base: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = { ...base };
  if (input.pointsPerReferral !== undefined) out.pointsPerReferral = validatePoints(input.pointsPerReferral);
  if (input.shareUrl !== undefined) out.shareUrl = validateShareUrl(input.shareUrl);
  if (input.showLeaderboard !== undefined) out.showLeaderboard = Boolean(input.showLeaderboard);
  if (input.hideCount !== undefined) out.hideCount = Boolean(input.hideCount);
  return out;
}

// ---------- ids ----------

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i

export function randomId(len: number, rand: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = rand(len * 2);
  let out = "";
  for (let i = 0; i < bytes.length && out.length < len; i++) {
    const b = bytes[i];
    if (b < 248) out += ALPHABET[b % 31]; // 248 = 31*8, avoids modulo bias
  }
  while (out.length < len) out += randomId(len - out.length, rand);
  return out;
}

function defaultRandom(n: number): Uint8Array {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

export function isId(s: unknown, min = 6, max = 40): s is string {
  return typeof s === "string" && s.length >= min && s.length <= max && /^[a-z0-9]+$/.test(s);
}

// ---------- ranking ----------

export interface RankedSignup {
  email: string;
  code: string;
  status: SignupStatus;
  joinedAt: number;
  joinOrder: number; // 1-based order of joining among non-removed signups
  referrals: number; // valid referrals
  referredBy: string | null;
  position: number | null; // place in line among waiting; null if admitted/removed
  source: SignupSource;
  statusChangedAt: number | null;
}

export interface Ranking {
  rows: RankedSignup[]; // waiting by position, then admitted, then removed
  byCode: Map<string, RankedSignup>;
  waiting: number;
  admitted: number;
  removed: number;
  total: number; // non-removed
  totalReferrals: number;
}

/**
 * Validity rule: a referral counts when the referred person is not removed and
 * did not sign up from the same IP as the referrer.
 */
export function referralCounts(signups: Signup[]): Map<string, number> {
  const byCode = new Map(signups.map((s) => [s.c, s]));
  const counts = new Map<string, number>();
  for (const s of signups) {
    if (!s.r || s.s === "removed") continue;
    const ref = byCode.get(s.r);
    if (!ref || ref.ip === s.ip) continue;
    counts.set(ref.c, (counts.get(ref.c) || 0) + 1);
  }
  return counts;
}

/** Score = join order − spots per referral × valid referrals. Lower is closer to the front. Ties go to whoever joined first (commit order). */
export function rank(ledger: Pick<Ledger, "signups" | "settings">): Ranking {
  const points = ledger.settings.pointsPerReferral;
  const counts = referralCounts(ledger.signups);
  // Line order is commit order: signups are only ever appended, so array order is the order they were accepted.
  const live = ledger.signups.filter((s) => s.s !== "removed");
  const order = new Map(live.map((s, i) => [s.c, i + 1]));

  const toRow = (s: Signup): RankedSignup => ({
    email: s.e,
    code: s.c,
    status: s.s,
    joinedAt: s.at,
    joinOrder: order.get(s.c) ?? 0,
    referrals: counts.get(s.c) || 0,
    referredBy: s.r,
    position: null,
    source: s.src,
    statusChangedAt: s.sa ?? null,
  });

  const waiting = live
    .filter((s) => s.s === "waiting")
    .map(toRow)
    .sort((a, b) => a.joinOrder - points * a.referrals - (b.joinOrder - points * b.referrals) || a.joinOrder - b.joinOrder);
  waiting.forEach((r, i) => (r.position = i + 1));

  const admitted = live.filter((s) => s.s === "admitted").map(toRow).sort((a, b) => (a.statusChangedAt ?? 0) - (b.statusChangedAt ?? 0));
  const removed = ledger.signups.filter((s) => s.s === "removed").map(toRow);
  const rows = [...waiting, ...admitted, ...removed];
  let totalReferrals = 0;
  counts.forEach((n) => (totalReferrals += n));
  return {
    rows,
    byCode: new Map(rows.map((r) => [r.code, r])),
    waiting: waiting.length,
    admitted: admitted.length,
    removed: removed.length,
    total: live.length,
    totalReferrals,
  };
}

// ---------- mutations ----------

export interface SignupInput {
  email: unknown;
  ref?: unknown;
  ipHash: string;
  now: number;
  source: SignupSource;
  newCode: () => string;
  newKey: () => string;
}

export interface SignupResult {
  signup: Signup;
  existing: boolean;
}

/** Adds a signup to the ledger in place. Duplicate emails return the existing record instead of a second row. */
export function addSignup(ledger: Ledger, input: SignupInput): SignupResult {
  const email = validateEmail(input.email);
  const found = ledger.signups.find((s) => s.e === email);
  if (found) {
    if (found.s === "removed") throw new WaitlistError("signup_closed", "This email can't join this waitlist.", 403);
    return { signup: found, existing: true };
  }
  if (ledger.signups.length >= LIMITS.maxSignups) throw new WaitlistError("waitlist_full", "This waitlist is full.", 409);

  const hourAgo = input.now - 3600_000;
  const recentFromIp = ledger.signups.filter((s) => s.ip === input.ipHash && s.at > hourAgo).length;
  if (recentFromIp >= LIMITS.perIpPerHour) throw new WaitlistError("rate_limited", "Too many signups from your network. Try again later.", 429);

  let ref: string | null = null;
  if (typeof input.ref === "string") {
    const code = input.ref.trim().toLowerCase();
    if (ledger.signups.some((s) => s.c === code)) ref = code;
  }

  const used = new Set(ledger.signups.map((s) => s.c));
  let code = input.newCode();
  for (let i = 0; used.has(code) && i < 10; i++) code = input.newCode();
  if (used.has(code)) throw new WaitlistError("code_collision", "Please try again.", 500);

  const signup: Signup = { e: email, c: code, k: input.newKey(), r: ref, ip: input.ipHash, at: input.now, s: "waiting", src: input.source };
  ledger.signups.push(signup);
  return { signup, existing: false };
}

export type AdminAction = "admit" | "unadmit" | "remove" | "restore";

export function applyAdminAction(ledger: Ledger, action: AdminAction, codes: string[], now: number): number {
  const set = new Set(codes);
  let changed = 0;
  for (const s of ledger.signups) {
    if (!set.has(s.c)) continue;
    const next: SignupStatus | null =
      action === "admit" ? (s.s === "waiting" ? "admitted" : null)
      : action === "unadmit" ? (s.s === "admitted" ? "waiting" : null)
      : action === "remove" ? (s.s !== "removed" ? "removed" : null)
      : action === "restore" ? (s.s === "removed" ? "waiting" : null)
      : null;
    if (next) {
      s.s = next;
      s.sa = now;
      changed++;
    }
  }
  return changed;
}

/** Codes of the first `n` people currently waiting, in line order. */
export function topWaiting(ledger: Ledger, n: number): string[] {
  return rank(ledger).rows.filter((r) => r.status === "waiting").slice(0, Math.max(0, n)).map((r) => r.code);
}

// ---------- presentation helpers ----------

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  const u = user.length <= 2 ? user[0] + "*" : user[0] + "*".repeat(Math.min(user.length - 2, 4)) + user[user.length - 1];
  const parts = domain.split(".");
  const d = parts[0][0] + "***";
  return `${u}@${d}.${parts.slice(1).join(".")}`;
}

export function referralLink(ledger: Pick<Ledger, "id" | "settings">, code: string, origin: string): string {
  const base = ledger.settings.shareUrl || `${origin}/w/${ledger.id}`;
  const u = new URL(base);
  u.searchParams.set("ref", code);
  return u.toString();
}

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(ledger: Ledger, origin: string): string {
  const r = rank(ledger);
  const header = ["position", "email", "status", "referrals", "referral_code", "referral_link", "referred_by", "joined_at", "status_changed_at", "source"];
  const lines = [header.join(",")];
  for (const row of r.rows) {
    lines.push(
      [
        row.position ?? "",
        row.email,
        row.status,
        row.referrals,
        row.code,
        referralLink(ledger, row.code, origin),
        row.referredBy ?? "",
        new Date(row.joinedAt).toISOString(),
        row.statusChangedAt ? new Date(row.statusChangedAt).toISOString() : "",
        row.source,
      ].map(csvCell).join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** Signups per day for the last `days` days (UTC), oldest first. */
export function dailySignups(ledger: Ledger, now: number, days = 14): { day: string; count: number }[] {
  const out: { day: string; count: number }[] = [];
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const counts = new Map<string, number>();
  for (const s of ledger.signups) {
    if (s.s === "removed") continue;
    const d = new Date(s.at).toISOString().slice(0, 10);
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start.getTime() - i * 86400_000).toISOString().slice(0, 10);
    out.push({ day: d, count: counts.get(d) || 0 });
  }
  return out;
}

export function publicInfo(ledger: Ledger) {
  const r = rank(ledger);
  return {
    id: ledger.id,
    name: ledger.name,
    description: ledger.description,
    count: ledger.settings.hideCount ? null : r.total,
    pointsPerReferral: ledger.settings.pointsPerReferral,
    showLeaderboard: ledger.settings.showLeaderboard,
    leaderboard: ledger.settings.showLeaderboard
      ? r.rows
          .filter((x) => x.status !== "removed" && x.referrals > 0)
          .sort((a, b) => b.referrals - a.referrals || a.joinedAt - b.joinedAt)
          .slice(0, 5)
          .map((x) => ({ who: maskEmail(x.email), referrals: x.referrals }))
      : [],
  };
}
