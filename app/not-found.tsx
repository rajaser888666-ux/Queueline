import Link from "next/link";
export default function NotFound() {
  return (
    <main className="wrap" style={{ padding: "96px 24px" }}>
      <h1 style={{ fontSize: 32, marginBottom: 12 }}>Not found</h1>
      <p style={{ color: "var(--muted)", marginBottom: 20 }}>This waitlist doesn&apos;t exist or the link is incomplete.</p>
      <Link className="btn" href="/">Go to Queueline</Link>
    </main>
  );
}
