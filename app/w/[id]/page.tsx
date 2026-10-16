import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Script from "next/script";
import Link from "next/link";
import { isId, publicInfo } from "@/lib/core";
import { readLedger } from "@/lib/store";

export const dynamic = "force-dynamic";

async function load(id: string) {
  if (!isId(id, 6, 20)) return null;
  const s = await readLedger(id, { cached: true });
  return s ? publicInfo(s.ledger) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const info = await load((await params).id);
  if (!info) return { title: "Waitlist not found" };
  return {
    title: { absolute: `Join the ${info.name} waitlist` },
    description: info.description || `Join the waitlist for ${info.name}.`,
    openGraph: { title: `Join the ${info.name} waitlist`, description: info.description || undefined },
  };
}

export default async function Hosted({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const info = await load(id);
  if (!info) notFound();
  return (
    <div className="hosted">
      <main>
        <div className="inner">
          <h1>{info.name}</h1>
          {info.description && <p className="desc">{info.description}</p>}
          <div id="ql-form" style={{ minHeight: 132 }} />
          <Script src="/embed.js" data-waitlist={id} data-mode="hosted" data-target="#ql-form" strategy="afterInteractive" />
          <noscript><p>Turn on JavaScript to join this waitlist.</p></noscript>
          {info.showLeaderboard && info.leaderboard.length > 0 && (
            <section className="board" aria-labelledby="board-h">
              <h2 id="board-h">Top referrers</h2>
              <ol>
                {info.leaderboard.map((r, i) => (
                  <li key={i}>{r.who}: {r.referrals} referral{r.referrals === 1 ? "" : "s"}</li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </main>
      <footer className="poweredby">
        Waitlist by <Link href="/">Queueline</Link>
      </footer>
    </div>
  );
}
