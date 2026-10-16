// Seeds a demo waitlist straight into the Blob store (one put). Usage: BLOB_READ_WRITE_TOKEN=… node scripts/seed-demo.mjs
import { put } from "@vercel/blob";
import { createHash, randomBytes } from "node:crypto";
const A = "abcdefghjkmnpqrstuvwxyz23456789";
const rid = (n) => { let s = ""; const b = randomBytes(n * 2); for (const x of b) { if (x < 248) s += A[x % 31]; if (s.length === n) break; } return s; };
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const first = ["maya","arjun","lena","tomas","priya","noah","sofia","kenji","amara","lucas","ines","omar","hana","felix","zara","diego","aisha","milo","nora","ravi","elena","jonas","leila","sam","yuki","ada","theo","isla","karan","mei","oscar","freya","nikhil","clara","emeka","ana","finn","lucia","dev","ivy"];
const last = ["shah","okafor","berg","reyes","kim","novak","patel","costa","haas","moreau","silva","ito","ward","lind","das","ferreira","mendes","quinn","rossi","tan"];
const domains = ["example.com","example.org","example.net"];
const now = Date.now(), DAY = 86400_000;
const id = rid(10), adminToken = rid(32);
const signups = []; const used = new Set();
const N = 146;
for (let i = 0; i < N; i++) {
  // growth curve: more signups in recent days
  const dayAgo = Math.floor(13.99 * Math.pow(rnd(), 1.6));
  const at = now - dayAgo * DAY - Math.floor(rnd() * DAY * 0.9);
  let e; do { e = `${first[Math.floor(rnd()*first.length)]}.${last[Math.floor(rnd()*last.length)]}${rnd() < 0.3 ? Math.floor(rnd()*90+10) : ""}@${domains[Math.floor(rnd()*3)]}`; } while (used.has(e)); used.add(e);
  signups.push({ e, c: rid(8), k: rid(20), r: null, ip: createHash("sha256").update("demo" + i).digest("hex").slice(0, 12), at, s: "waiting", src: rnd() < 0.6 ? "widget" : "hosted" });
}
signups.sort((a, b) => a.at - b.at);
// a handful of strong referrers among the early-middle joiners
const referrers = [12, 31, 47, 58, 80, 95].map((i) => signups[i]);
const weights = [11, 7, 5, 4, 3, 2];
for (let i = 0; i < signups.length; i++) {
  const s = signups[i];
  let pick = null;
  for (let j = 0; j < referrers.length; j++) if (referrers[j].at < s.at && rnd() < weights[j] / 70) { pick = referrers[j]; break; }
  if (!pick && rnd() < 0.08) { const earlier = signups.slice(0, i); if (earlier.length) pick = earlier[Math.floor(rnd() * earlier.length)]; }
  if (pick && pick !== s) s.r = pick.c;
}
// first 6 in line were let in two days ago
for (const s of signups.slice(0, 6)) { s.s = "admitted"; s.sa = now - 2 * DAY + Math.floor(rnd() * 3600_000); }
const ledger = {
  v: 1, id, name: "Fernway",
  description: "Trip planning for groups that actually ends in a booked trip. One shared itinerary, one budget, no 200-message group chat. Private beta opens in November.",
  ownerEmail: "hello@superagency.dev", adminHash: createHash("sha256").update(adminToken).digest("hex"), createdAt: now - 14 * DAY,
  settings: { pointsPerReferral: 5, shareUrl: null, showLeaderboard: true, hideCount: false }, signups,
};
await put(`wl/${id}.json`, JSON.stringify(ledger), { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json", cacheControlMaxAge: 60 });
console.log(JSON.stringify({ id, adminToken, signups: signups.length, referred: signups.filter((s) => s.r).length }));
