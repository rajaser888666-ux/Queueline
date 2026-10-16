import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.QL_BASE_URL || "http://localhost:3300").replace(/\/$/, "");
const TEST_KEY = process.env.QL_TEST_KEY || "";
const run = Math.random().toString(36).slice(2, 7);
const shots = process.env.QL_SHOTS || "test-results";
const EMBED_PORT = 4555;
const EMBED_ORIGIN = `http://localhost:${EMBED_PORT}`;

let server: http.Server;
test.beforeAll(async () => {
  fs.mkdirSync(shots, { recursive: true });
  // A "customer landing page" on a different origin that embeds the widget with one script tag.
  server = http.createServer((req, res) => {
    const id = new URL(req.url || "/", EMBED_ORIGIN).searchParams.get("wl") || "";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acme landing page</title>
<style>body{font-family:Georgia,serif;background:#fff3e0;margin:40px} input,button{all:unset}</style></head>
<body><main><h1>Acme is coming soon</h1><p>Hostile host CSS above should not affect the widget.</p>
<script src="${BASE}/embed.js" data-waitlist="${id}" data-button="Get early access" async></script></main></body></html>`);
  });
  await new Promise<void>((r) => server.listen(EMBED_PORT, r));
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

/** Give each browser context its own network identity so referral and rate-limit rules behave as with real people. */
async function persona(ctx: BrowserContext, name: string) {
  await ctx.route(`${BASE}/api/waitlists/**`, (route) => {
    const headers = { ...route.request().headers() };
    if (TEST_KEY) { headers["x-ql-test-key"] = TEST_KEY; headers["x-ql-test-ip"] = `${run}-${name}`; }
    else headers["x-real-ip"] = `10.0.${run.length}.${name.length}-${name}`;
    return route.continue({ headers });
  });
}

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  fs.appendFileSync(path.join(shots, "axe.txt"), `${label}: ${r.violations.length} violations ${summary.join("; ")}\n`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

async function apiSignup(id: string, email: string, ip: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (TEST_KEY) { headers["x-ql-test-key"] = TEST_KEY; headers["x-ql-test-ip"] = `${run}-${ip}`; } else headers["x-real-ip"] = `${run}-${ip}`;
  const r = await fetch(`${BASE}/api/waitlists/${id}/signups`, { method: "POST", headers, body: JSON.stringify({ email, elapsed: 4000 }) });
  expect(r.status).toBe(201);
  return r.json();
}

test("create → hosted signup → embedded widget referral → admin offers spot → CSV", async ({ browser }) => {
  // 1. Creator makes a waitlist on the landing page
  const owner = await browser.newContext();
  await persona(owner, "owner");
  const op = await owner.newPage();
  await op.goto("/");
  await expect(op.getByRole("heading", { level: 1 })).toContainText("referrals move people up the line");
  await axe(op, "landing");
  await op.getByRole("button", { name: "Create waitlist" }).click();
  await expect(op.getByLabel("Product or waitlist name")).toBeFocused(); // native validation stops empty submit
  await op.getByLabel("Product or waitlist name").fill(`Acme beta ${run}`);
  await op.getByLabel("Your email").fill("founder@acme.example");
  await op.getByLabel(/Short description/).fill("Be first to try Acme when the beta opens.");
  await op.getByLabel("Spots gained per referral").fill("5");
  await op.getByRole("button", { name: "Create waitlist" }).click();
  const created = op.getByTestId("created");
  await expect(created).toContainText(`Acme beta ${run} is live`);
  const adminUrl = await op.getByLabel("Your private admin link").inputValue();
  const hostedUrl = await op.getByLabel("Hosted signup page").inputValue();
  const id = hostedUrl.split("/w/")[1];
  expect(adminUrl).toMatch(new RegExp(`/admin/${id}#k=[a-z0-9]{32}$`));
  expect(await op.getByLabel("Embed on your site").inputValue()).toContain(`data-waitlist="${id}"`);
  await op.screenshot({ path: path.join(shots, "01-created.png"), fullPage: true });

  // 2. Alice joins on the hosted page
  const alice = await browser.newContext();
  await persona(alice, "alice");
  const ap = await alice.newPage();
  await ap.goto(hostedUrl);
  await expect(ap.getByRole("heading", { level: 1 })).toHaveText(`Acme beta ${run}`);
  await expect(ap.getByText("Be first to try Acme")).toBeVisible();
  await ap.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(ap.getByText("Enter a valid email address.")).toBeVisible();
  await ap.getByLabel("Email address").fill(`alice.${run}@example.com`);
  await ap.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(ap.getByTestId("ql-position")).toHaveText(/^#1/);
  await expect(ap.getByText("You’re on the list.")).toBeVisible();
  await axe(ap, "hosted-success");
  await ap.screenshot({ path: path.join(shots, "02-hosted-success.png"), fullPage: true });

  // a few more people join through the API
  for (const n of ["p2", "p3", "p4"]) await apiSignup(id, `${n}.${run}@example.com`, n);

  // 3. Dave joins on the hosted page and gets his referral link
  const dave = await browser.newContext();
  await persona(dave, "dave");
  const dp = await dave.newPage();
  await dp.goto(hostedUrl);
  await axe(dp, "hosted-form");
  await dp.getByLabel("Email address").fill(`dave.${run}@example.com`);
  await dp.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(dp.getByTestId("ql-position")).toHaveText(/^#5/);
  const daveLink = await dp.getByLabel("Your referral link").inputValue();
  const daveCode = new URL(daveLink).searchParams.get("ref")!;
  expect(daveLink).toBe(`${BASE}/w/${id}?ref=${daveCode}`);

  // 4. Erin finds the embedded widget on a third-party site via Dave's link (ref carried on the host page URL)
  const erin = await browser.newContext();
  await persona(erin, "erin");
  const ep = await erin.newPage();
  await ep.goto(`${EMBED_ORIGIN}/?wl=${id}&ref=${daveCode}`);
  const button = ep.getByRole("button", { name: "Get early access" });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box!.height).toBeGreaterThan(30); // host page's `all:unset` didn't flatten the widget button
  await expect(ep.getByText(/5 people have joined\./)).toBeVisible();
  await axe(ep, "embed-form");
  await ep.getByLabel("Email address").fill(`erin.${run}@example.org`);
  await button.click();
  await expect(ep.getByTestId("ql-position")).toHaveText(/^#6/);
  await ep.screenshot({ path: path.join(shots, "03-embed-success.png"), fullPage: true });

  // a duplicate signup through the widget doesn't create a second row
  const erin2 = await browser.newContext();
  await persona(erin2, "erin2");
  const e2 = await erin2.newPage();
  await e2.goto(`${EMBED_ORIGIN}/?wl=${id}`);
  await e2.getByLabel("Email address").fill(`ERIN.${run}@example.org`);
  await e2.getByRole("button", { name: "Get early access" }).click();
  await expect(e2.getByText("You’re already on the list.")).toBeVisible();

  // 5. Dave comes back: his referral moved him from #5 to #1 (5 − 5×1 = 0)
  await dp.reload();
  await expect(dp.getByText("Welcome back.")).toBeVisible();
  await expect(dp.getByTestId("ql-position")).toHaveText(/^#1/);
  await expect(dp.getByTestId("ql-referrals")).toHaveText("1");

  // 6. Admin sees it, offers Dave a spot, exports CSV
  await op.goto(adminUrl);
  await expect(op.getByRole("heading", { level: 1 })).toHaveText(`Acme beta ${run}`);
  await expect(op.getByTestId("stat-total")).toHaveText("6");
  await expect(op.getByTestId("stat-referrals")).toHaveText("1");
  const daveRow = op.locator(`tr[data-code="${daveCode}"]`);
  await expect(daveRow.locator("td").nth(0)).toHaveText("1");
  await expect(daveRow.locator("td").nth(2)).toHaveText("1");
  const erinRow = op.locator("tr", { hasText: `erin.${run}@example.org` });
  await expect(erinRow).toContainText(`dave.${run}@example.com`);
  await axe(op, "admin-people");
  await op.screenshot({ path: path.join(shots, "04-admin.png"), fullPage: true });
  await daveRow.getByRole("button", { name: "Offer spot" }).click();
  await expect(op.getByTestId("stat-admitted")).toHaveText("1");
  await expect(daveRow).toContainText("admitted");
  await expect(daveRow.getByRole("link", { name: "Email" })).toHaveAttribute("href", new RegExp(`^mailto:dave\\.${run}@example\\.com\\?subject=`));
  await expect(op.locator("tr", { hasText: `alice.${run}@example.com` }).locator("td").nth(0)).toHaveText("1");

  const [download] = await Promise.all([op.waitForEvent("download"), op.getByRole("button", { name: "Export CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^acme-beta-[a-z0-9]+-\d{4}-\d{2}-\d{2}\.csv$/);
  const csvPath = path.join(shots, "export.csv");
  await download.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, "utf8").replace(/^\ufeff/, "").trim().split(/\r\n/);
  expect(csv).toHaveLength(7);
  expect(csv[0]).toContain("position,email,status,referrals");
  expect(csv.find((l) => l.includes(`dave.${run}`))).toContain(",admitted,1,");
  expect(csv.find((l) => l.includes(`erin.${run}`))).toContain(`,${daveCode},`);

  // settings tab saves and is accessible
  await op.getByRole("tab", { name: "Settings" }).click();
  await op.getByLabel(/Share URL/).fill("https://acme.example/launch");
  await op.getByRole("button", { name: "Save settings" }).click();
  await expect(op.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
  await axe(op, "admin-settings");
  await op.getByRole("tab", { name: "Share & embed" }).click();
  await expect(op.getByText("https://acme.example/launch")).toBeVisible();
  await axe(op, "admin-share");

  // 7. Dave sees he's in
  await dp.reload();
  await expect(dp.getByText("You’re in.")).toBeVisible();
  await dp.screenshot({ path: path.join(shots, "05-admitted.png"), fullPage: true });

  // wrong admin key is refused
  const stranger = await browser.newContext();
  const sp = await stranger.newPage();
  await sp.goto(`${BASE}/admin/${id}#k=${"x".repeat(32)}`);
  await expect(sp.getByRole("alert").filter({ hasText: "admin link" })).toContainText("This admin link isn't valid.");
  await axe(sp, "admin-denied");

  for (const c of [owner, alice, dave, erin, erin2, stranger]) await c.close();
});

test("unknown waitlist shows a not-found page; mobile layout holds", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const res = await p.goto("/w/zzzzzzzzzz");
  expect(res!.status()).toBe(404);
  await expect(p.getByRole("heading", { name: "Not found" })).toBeVisible();
  await p.goto("/");
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await p.screenshot({ path: path.join(shots, "06-mobile-landing.png"), fullPage: true });
  await ctx.close();
});
