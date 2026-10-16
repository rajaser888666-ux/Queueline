"use client";
import { useRef, useState } from "react";

interface Created { id: string; name: string; adminUrl: string; hostedUrl: string; embedSnippet: string }

export function CreateForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const shownAt = useRef(Date.now());

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/waitlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: f.get("name"),
          ownerEmail: f.get("ownerEmail"),
          description: f.get("description"),
          pointsPerReferral: Number(f.get("points")),
          shareUrl: f.get("shareUrl") || null,
          website: f.get("website"),
          elapsed: Date.now() - shownAt.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Couldn't create the waitlist.");
      setCreated(data);
      try {
        const list = JSON.parse(localStorage.getItem("queueline:mine") || "[]");
        list.unshift({ id: data.id, name: data.name, adminUrl: data.adminUrl, at: Date.now() });
        localStorage.setItem("queueline:mine", JSON.stringify(list.slice(0, 20)));
      } catch {}
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="panel created" data-testid="created">
        <h2>{created.name} is live</h2>
        <div className="field">
          <label htmlFor="adminUrl">Your private admin link</label>
          <div className="copyrow">
            <input id="adminUrl" readOnly value={created.adminUrl} onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={created.adminUrl} />
          </div>
        </div>
        <p className="warn">Save this link now. It&apos;s the only key to your dashboard and can&apos;t be recovered. It&apos;s also kept in this browser.</p>
        <div className="field">
          <label htmlFor="hostedUrl">Hosted signup page</label>
          <div className="copyrow">
            <input id="hostedUrl" readOnly value={created.hostedUrl} />
            <CopyButton text={created.hostedUrl} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="embed">Embed on your site</label>
          <textarea id="embed" readOnly value={created.embedSnippet} rows={3} className="mono" />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <a className="btn" href={created.adminUrl}>Open dashboard</a>
          <a className="btn secondary" href={created.hostedUrl} target="_blank" rel="noopener">View signup page</a>
        </div>
      </div>
    );
  }

  return (
    <form className="panel" onSubmit={onSubmit} aria-labelledby="create-h">
      <h2 id="create-h">Create a waitlist</h2>
      <div className="field">
        <label htmlFor="name">Product or waitlist name</label>
        <input id="name" name="name" type="text" required minLength={2} maxLength={80} placeholder="Acme beta" />
      </div>
      <div className="field">
        <label htmlFor="ownerEmail">Your email</label>
        <input id="ownerEmail" name="ownerEmail" type="email" required autoComplete="email" placeholder="you@company.com" />
      </div>
      <div className="field">
        <label htmlFor="description">Short description <span className="help">(shown on the signup page, optional)</span></label>
        <textarea id="description" name="description" maxLength={280} placeholder="Be first to try Acme when we open the beta." />
      </div>
      <div className="field">
        <label htmlFor="points">Spots gained per referral</label>
        <input id="points" name="points" type="number" min={0} max={1000} defaultValue={5} required />
      </div>
      <div className="field">
        <label htmlFor="shareUrl">Your landing page <span className="help">(optional; referral links will point here)</span></label>
        <input id="shareUrl" name="shareUrl" type="url" placeholder="https://acme.com" />
      </div>
      <div className="hp" aria-hidden="true">
        <label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {error && <p className="err" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create waitlist"}</button>
    </form>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn secondary small"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch {}
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}
