import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { WaitlistError, isId, type Ledger } from "./core";
import { readLedger } from "./store";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function fail(e: unknown, headers: Record<string, string> = {}) {
  if (e instanceof WaitlistError) return json({ error: e.code, message: e.message }, e.status, headers);
  console.error(e);
  return json({ error: "server_error", message: "Something went wrong on our side. Please try again." }, 500, headers);
}

export function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

export function clientIp(req: Request): string {
  const h = req.headers;
  // Test hook: only active when QL_TEST_KEY is configured and the caller presents it.
  const testKey = process.env.QL_TEST_KEY;
  if (testKey && testKey.length >= 16 && h.get("x-ql-test-key") === testKey) {
    const fake = h.get("x-ql-test-ip");
    if (fake) return "test:" + fake.slice(0, 64);
  }
  return (h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "local").trim();
}

/** Salted, truncated hash: enough to compare IPs, not enough to recover them. */
export function ipHash(ip: string, waitlistId: string) {
  return sha256(`${process.env.IP_SALT || "queueline"}:${waitlistId}:${ip}`).slice(0, 12);
}

export function originOf(req: Request): string {
  const env = process.env.PUBLIC_ORIGIN;
  if (env) return env.replace(/\/$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || u.host;
  const proto = req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function readBody(req: Request, max = 4096): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > max) throw new WaitlistError("too_large", "Request too large.", 413);
  if (!text) return {};
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {}
  throw new WaitlistError("bad_json", "Request body must be a JSON object.");
}

export function checkId(id: string) {
  if (!isId(id, 6, 20)) throw new WaitlistError("not_found", "Waitlist not found.", 404);
}

export function tokenFrom(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

export function verifyAdmin(ledger: Ledger, token: string) {
  const a = Buffer.from(sha256(token || "-"));
  const b = Buffer.from(ledger.adminHash);
  if (!token || a.length !== b.length || !timingSafeEqual(a, b)) throw new WaitlistError("unauthorized", "This admin link isn't valid.", 401);
}

export async function loadAdmin(req: Request, id: string): Promise<Ledger> {
  checkId(id);
  const stored = await readLedger(id);
  if (!stored) throw new WaitlistError("not_found", "Waitlist not found.", 404);
  verifyAdmin(stored.ledger, tokenFrom(req));
  return stored.ledger;
}

// Per-instance burst limiter (first line of defence; the ledger enforces a durable per-IP cap too).
const hits = new Map<string, number[]>();
export function burstLimit(key: string, max: number, windowMs: number, now = Date.now()) {
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    throw new WaitlistError("rate_limited", "Too many requests. Slow down and try again in a minute.", 429);
  }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
}
