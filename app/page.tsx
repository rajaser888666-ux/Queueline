import Link from "next/link";
import { Logo } from "@/components/Logo";
import { CreateForm } from "./CreateForm";

export const dynamic = "force-static";

export default function Home() {
  const demo = process.env.DEMO_WAITLIST_ID;
  return (
    <>
      <div className="wrap">
        <header className="top">
          <Link href="/" className="brand"><Logo /> Queueline</Link>
          <nav>
            {demo && <Link href={`/w/${demo}`}>Live demo</Link>}
            <a href="#how" className="wide-only">How it works</a>
            <a href="#embed" className="wide-only">Embed</a>
          </nav>
        </header>
        <main>
          <section className="hero">
            <div>
              <h1>A waitlist where referrals move people up the line.</h1>
              <p className="lede">
                Collect emails on a hosted page or on your own site. Everyone who joins gets their place in line and a personal link.
                Each friend who signs up through it moves them closer to the front.
              </p>
              <ul className="facts">
                <li>Free, with no signup limit and no account to create.</li>
                <li>One script tag for any site: Webflow, Framer, WordPress, plain HTML.</li>
                <li>A private admin link to see the list, offer spots and export CSV.</li>
              </ul>
            </div>
            <CreateForm />
          </section>

          <section className="section" id="how">
            <h2>How it works</h2>
            <ol className="steps">
              <li>
                <h3>Create a waitlist</h3>
                <p>Name it and choose how many spots a referral is worth. You get a hosted page, an embed snippet and a private admin link.</p>
              </li>
              <li>
                <h3>People join and share</h3>
                <p>Each signup sees their position and gets a link like <code>?ref=k7m2q9xa</code>. Friends who join through it count as referrals.</p>
              </li>
              <li>
                <h3>You let people in</h3>
                <p>Your dashboard ranks everyone by join order minus referral credit. Offer spots one by one or to the top of the line, then export.</p>
              </li>
            </ol>
          </section>

          <section className="section" id="embed">
            <h2>Put it on your own site</h2>
            <div className="grid2" style={{ paddingTop: 0, paddingBottom: 0 }}>
              <div>
                <p style={{ marginBottom: 14 }}>Paste one line where the form should appear. It renders in an isolated shadow root, so your site&apos;s CSS can&apos;t break it and it can&apos;t break your site.</p>
                <pre className="code">{`<script src="https://queueline-rouge.vercel.app/embed.js"\n  data-waitlist="YOUR_WAITLIST_ID" async></script>`}</pre>
              </div>
              <div>
                <p style={{ marginBottom: 14 }}>Optional attributes:</p>
                <table className="compare">
                  <tbody>
                    <tr><th scope="row"><code>data-target</code></th><td>CSS selector to render into</td></tr>
                    <tr><th scope="row"><code>data-button</code></th><td>Button text</td></tr>
                    <tr><th scope="row"><code>data-accent</code></th><td>Button colour, e.g. <code>#1d4ed8</code></td></tr>
                    <tr><th scope="row"><code>data-placeholder</code></th><td>Email placeholder</td></tr>
                  </tbody>
                </table>
                <p style={{ marginTop: 14, color: "var(--muted)", fontSize: 15 }}>
                  Set your landing page as the share URL in settings and referral links will point there instead of the hosted page.
                </p>
              </div>
            </div>
          </section>

          <section className="section">
            <h2>Compared with paid waitlist tools</h2>
            <div className="scrollx">
            <table className="compare">
              <thead>
                <tr><th scope="col"></th><th scope="col">Queueline</th><th scope="col">GetWaitlist Basic</th><th scope="col">LaunchList free</th></tr>
              </thead>
              <tbody>
                <tr><th scope="row">Price</th><td className="yes">Free</td><td>$15/month</td><td>Free</td></tr>
                <tr><th scope="row">Referral positions</th><td className="yes">Yes</td><td>Yes</td><td>Up to 100 signups</td></tr>
                <tr><th scope="row">Account needed</th><td className="yes">No, admin by private link</td><td>Yes</td><td>Yes</td></tr>
                <tr><th scope="row">Emails to your list</th><td>Not included. Export CSV to your mail tool</td><td>Included</td><td>Verification emails</td></tr>
              </tbody>
            </table>
            </div>
            <p style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}>Competitor pricing from their public pages, checked October 2026.</p>
          </section>
        </main>
      </div>
      <footer className="foot">
        <div className="wrap">Queueline, built by SuperAgency. Signups are stored privately and never shared.</div>
      </footer>
    </>
  );
}
