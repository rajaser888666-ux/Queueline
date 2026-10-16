// HTTP API tests. Run against any deployment: QL_BASE_URL=https://… QL_TEST_KEY=… npm run test:integration
import { describe, expect, it, beforeAll } from "vitest";

const BASE = (process.env.QL_BASE_URL || "http://localhost:3300").replace(/\/$/, "");
const TEST_KEY = process.env.QL_TEST_KEY || "";
const run = Math.random().toString(36).slice(2, 8);
let ipSeq = 0;
const newIp = () => `${run}-${++ipSeq}`;

async function call(path: string, init: RequestInit & { ip?: string; token?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as Record<string, string>) };
  if (TEST_KEY) { headers["x-ql-test-key"] = TEST_KEY; headers["x-ql-test-ip"] = init.ip || newIp(); }
  else headers["x-real-ip"] = init.ip || newIp(); // local `next start` trusts x-real-ip
  if (init.token) headers["Authorization"] = `Bearer ${init.token}`;
  const res = await fetch(BASE + path, { ...init, headers });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body, headers: res.headers };
}
const post = (path: string, data: unknown, opts: { ip?: string; token?: string } = {}) => call(path, { method: "POST", body: JSON.stringify(data), ...opts });

async function createList(extra: Record<string, unknown> = {}) {
  const r = await post("/api/waitlists", { name: `API test ${run}`, ownerEmail: "owner@superagency.dev", ...extra });
  expect(r.status).toBe(201);
  return r.body as { id: string; adminToken: string; adminUrl: string; hostedUrl: string; embedSnippet: string };
}
const signup = (id: string, email: string, extra: Record<string, unknown> = {}, ip?: string) =>
  post(`/api/waitlists/${id}/signups`, { email, elapsed: 5000, source: "api", ...extra }, { ip });

describe(`Queueline API @ ${BASE}`, () => {
  let wl: Awaited<ReturnType<typeof createList>>;
  beforeAll(async () => { wl = await createList({ pointsPerReferral: 2, description: "integration" }); });

  it("validates waitlist creation", async () => {
    expect((await post("/api/waitlists", { name: "x", ownerEmail: "a@b.com" })).body.error).toBe("name_invalid");
    expect((await post("/api/waitlists", { name: "Okay", ownerEmail: "nope" })).body.error).toBe("owner_email_invalid");
    expect((await post("/api/waitlists", { name: "Okay", ownerEmail: "a@b.com", shareUrl: "ftp://x" })).body.error).toBe("share_url_invalid");
    expect((await post("/api/waitlists", { name: "Okay", ownerEmail: "a@b.com", pointsPerReferral: -3 })).body.error).toBe("points_invalid");
    expect((await post("/api/waitlists", { name: "Okay", ownerEmail: "a@b.com", website: "spam" })).status).toBe(400);
    expect((await call("/api/waitlists", { method: "POST", body: "[1,2]" })).body.error).toBe("bad_json");
  });

  it("returns links and public info for a new waitlist", async () => {
    expect(wl.id).toMatch(/^[a-z0-9]{10}$/);
    expect(wl.adminToken).toMatch(/^[a-z0-9]{32}$/);
    expect(wl.adminUrl).toBe(`${BASE}/admin/${wl.id}#k=${wl.adminToken}`);
    expect(wl.embedSnippet).toContain(`data-waitlist="${wl.id}"`);
    const info = await call(`/api/waitlists/${wl.id}`);
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({ id: wl.id, name: `API test ${run}`, count: 0, pointsPerReferral: 2 });
    expect(JSON.stringify(info.body)).not.toContain("owner@");
    expect(JSON.stringify(info.body)).not.toContain("adminHash");
  });

  it("404s unknown and malformed ids", async () => {
    expect((await call("/api/waitlists/zzzzzzzzzz")).status).toBe(404);
    expect((await call("/api/waitlists/..%2Fetc")).status).toBe(404);
    expect((await signup("zzzzzzzzzz", "a@example.com")).status).toBe(404);
  });

  it("answers CORS preflight for the widget", async () => {
    const r = await fetch(`${BASE}/api/waitlists/${wl.id}/signups`, { method: "OPTIONS", headers: { Origin: "https://someone-else.example", "Access-Control-Request-Method": "POST" } });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects bad emails", async () => {
    expect((await signup(wl.id, "not-an-email")).body.error).toBe("email_invalid");
    expect((await signup(wl.id, "")).body.error).toBe("email_required");
    expect((await signup(wl.id, "x@mailinator.com")).body.error).toBe("email_disposable");
  });

  let first: any;
  it("signs up, returns position, referral link and status key", async () => {
    const r = await signup(wl.id, `First.${run}@Example.com`);
    expect(r.status).toBe(201);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    first = r.body;
    expect(first).toMatchObject({ ok: true, existing: false, status: "waiting", position: 1, total: 1, referrals: 0 });
    expect(first.referralLink).toBe(`${BASE}/w/${wl.id}?ref=${first.referralCode}`);
    expect(first.statusKey).toMatch(/^[a-z0-9]{20}$/);
  });

  it("dedupes the same email (any case) without handing out the status key", async () => {
    const r = await signup(wl.id, `  FIRST.${run}@example.COM `);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ existing: true, referralCode: first.referralCode, position: 1, statusKey: null });
    expect((await call(`/api/waitlists/${wl.id}`)).body.count).toBe(1);
  });

  it("silently drops honeypot submissions and asks too-fast ones to confirm", async () => {
    const hp = await signup(wl.id, `bot1.${run}@example.com`, { website: "http://spam" });
    const fast = await signup(wl.id, `bot2.${run}@example.com`, { elapsed: 120 });
    expect(hp.status).toBe(200);
    expect(fast.status).toBe(400);
    expect(fast.body.error).toBe("too_fast");
    expect(hp.body.referralLink).toBeNull();
    const admin = await call(`/api/waitlists/${wl.id}/admin`, { token: wl.adminToken });
    expect(admin.body.rows.map((r: any) => r.email)).not.toContain(`bot1.${run}@example.com`);
    expect(admin.body.stats.total).toBe(1);
  });

  const people: any[] = [];
  it("referral signups move the referrer up by the configured points", async () => {
    people.push(first);
    for (let i = 2; i <= 4; i++) people.push((await signup(wl.id, `p${i}.${run}@example.com`)).body);
    expect(people.map((p) => p.position)).toEqual([1, 2, 3, 4]);
    const p4 = people[3];
    const friend = await signup(wl.id, `friend.${run}@example.org`, { ref: p4.referralCode });
    expect(friend.status).toBe(201);
    expect(friend.body.position).toBe(5);
    const st = await call(`/api/waitlists/${wl.id}/status?key=${p4.statusKey}`);
    expect(st.status).toBe(200);
    // join order 4 − 2 × 1 referral = 2, tie with #2 who joined earlier → 3rd
    expect(st.body).toMatchObject({ position: 3, referrals: 1, status: "waiting" });
  });

  it("does not count referrals from the referrer's own network", async () => {
    const ip = newIp();
    const a = (await signup(wl.id, `selfref.${run}@example.com`, {}, ip)).body;
    await signup(wl.id, `selfref2.${run}@example.com`, { ref: a.referralCode }, ip);
    const st = await call(`/api/waitlists/${wl.id}/status?key=${a.statusKey}`);
    expect(st.body.referrals).toBe(0);
  });

  it("status lookups need a valid key", async () => {
    expect((await call(`/api/waitlists/${wl.id}/status?key=bad`)).status).toBe(404);
    expect((await call(`/api/waitlists/${wl.id}/status?key=${"a".repeat(20)}`)).status).toBe(404);
  });

  it("admin endpoints require the token", async () => {
    expect((await call(`/api/waitlists/${wl.id}/admin`)).status).toBe(401);
    expect((await call(`/api/waitlists/${wl.id}/admin`, { token: "x".repeat(32) })).status).toBe(401);
    expect((await call(`/api/waitlists/${wl.id}/admin/export`, { token: "nope" })).status).toBe(401);
    expect((await post(`/api/waitlists/${wl.id}/admin/actions`, { action: "admit", top: 1 }, { token: "nope" })).status).toBe(401);
    expect((await post(`/api/waitlists/${wl.id}/admin`, { name: "Hijack" }, { token: "nope" })).status).toBe(401);
  });

  it("admin sees everyone with positions and referral counts", async () => {
    const r = await call(`/api/waitlists/${wl.id}/admin`, { token: wl.adminToken });
    expect(r.status).toBe(200);
    expect(r.body.stats).toMatchObject({ total: 7, waiting: 7, admitted: 0, referrals: 1 });
    const p4row = r.body.rows.find((x: any) => x.code === people[3].referralCode);
    expect(p4row).toMatchObject({ position: 3, referrals: 1 });
    expect(r.body.rows.find((x: any) => x.email === `friend.${run}@example.org`).referredBy).toBe(people[3].referralCode);
    expect(r.body.daily).toHaveLength(14);
  });

  it("offers spots (by code and to the top of the line), undoes and removes", async () => {
    const t = wl.adminToken;
    const a1 = await post(`/api/waitlists/${wl.id}/admin/actions`, { action: "admit", codes: [people[1].referralCode] }, { token: t });
    expect(a1.body).toMatchObject({ ok: true, changed: 1 });
    const top = await post(`/api/waitlists/${wl.id}/admin/actions`, { action: "admit", top: 1 }, { token: t });
    expect(top.body.changed).toBe(1);
    expect(top.body.codes).toEqual([people[0].referralCode]);
    const st = await call(`/api/waitlists/${wl.id}/status?key=${people[0].statusKey}`);
    expect(st.body).toMatchObject({ status: "admitted", position: null });
    const st4 = await call(`/api/waitlists/${wl.id}/status?key=${people[3].statusKey}`);
    expect(st4.body.position).toBe(1); // the two ahead were admitted
    await post(`/api/waitlists/${wl.id}/admin/actions`, { action: "unadmit", codes: [people[1].referralCode] }, { token: t });
    const rm = await post(`/api/waitlists/${wl.id}/admin/actions`, { action: "remove", codes: [people[2].referralCode] }, { token: t });
    expect(rm.body.changed).toBe(1);
    expect((await call(`/api/waitlists/${wl.id}/status?key=${people[2].statusKey}`)).status).toBe(404);
    expect((await signup(wl.id, `p3.${run}@example.com`)).status).toBe(403);
    const bad = await post(`/api/waitlists/${wl.id}/admin/actions`, { action: "explode", codes: ["x"] }, { token: t });
    expect(bad.body.error).toBe("action_invalid");
    expect((await post(`/api/waitlists/${wl.id}/admin/actions`, { action: "admit" }, { token: t })).body.error).toBe("codes_required");
  });

  it("updates settings and re-ranks", async () => {
    const t = wl.adminToken;
    const bad = await post(`/api/waitlists/${wl.id}/admin`, { settings: { pointsPerReferral: 5000 } }, { token: t });
    expect(bad.body.error).toBe("points_invalid");
    const ok = await post(`/api/waitlists/${wl.id}/admin`, { name: `Renamed ${run}`, settings: { pointsPerReferral: 0, shareUrl: "https://acme.example/launch", hideCount: true } }, { token: t });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ pointsPerReferral: 0, shareUrl: "https://acme.example/launch", hideCount: true });
    const st = await call(`/api/waitlists/${wl.id}/status?key=${people[3].statusKey}`);
    expect(st.body.referralLink).toBe(`https://acme.example/launch?ref=${people[3].referralCode}`);
    expect(st.body.total).toBeNull();
    // with 0 points p4 falls back behind p2 (unadmitted)
    expect(st.body.position).toBe(2);
  });

  it("exports CSV", async () => {
    const res = await fetch(`${BASE}/api/waitlists/${wl.id}/admin/export`, { headers: { Authorization: `Bearer ${wl.adminToken}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="renamed-[a-z0-9]+-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = (await res.text()).replace(/^\ufeff/, "").trim().split("\r\n");
    expect(lines[0]).toBe("position,email,status,referrals,referral_code,referral_link,referred_by,joined_at,status_changed_at,source");
    expect(lines).toHaveLength(1 + 7);
    expect(lines.some((l) => l.includes(`friend.${run}@example.org`) && l.includes(people[3].referralCode))).toBe(true);
    expect(lines.filter((l) => l.includes(",admitted,"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes(",removed,"))).toHaveLength(1);
  });

  it("keeps every signup under concurrent writes", async () => {
    const w2 = await createList();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => signup(w2.id, `c${i}.${run}@example.com`)));
    expect(results.map((r) => r.status).sort()).toEqual(Array(6).fill(201));
    expect(new Set(results.map((r) => r.body.position))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    const admin = await call(`/api/waitlists/${w2.id}/admin`, { token: w2.adminToken });
    expect(admin.body.stats.total).toBe(6);
  });

  it("caps signups from one network per hour", async () => {
    const ip = newIp();
    const w3 = await createList();
    for (let i = 0; i < 5; i++) expect((await signup(w3.id, `rl${i}.${run}@example.com`, {}, ip)).status).toBe(201);
    const sixth = await signup(w3.id, `rl6.${run}@example.com`, {}, ip);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe("rate_limited");
  });
});
