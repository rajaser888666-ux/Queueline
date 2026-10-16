"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/Logo";
import { CopyButton } from "../../CreateForm";

interface Row {
  email: string; code: string; status: "waiting" | "admitted" | "removed"; joinedAt: number; joinOrder: number;
  referrals: number; referredBy: string | null; position: number | null; source: string; statusChangedAt: number | null; referralLink: string;
}
interface Data {
  id: string; name: string; description: string; ownerEmail: string; createdAt: number;
  settings: { pointsPerReferral: number; shareUrl: string | null; showLeaderboard: boolean; hideCount: boolean };
  hostedUrl: string; embedSnippet: string;
  stats: { total: number; waiting: number; admitted: number; removed: number; referrals: number };
  daily: { day: string; count: number }[];
  rows: Row[];
}
type Tab = "people" | "share" | "settings";
type SortKey = "position" | "referrals" | "joinedAt";

export function AdminApp({ id }: { id: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("people");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | Row["status"]>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "position", dir: 1 });
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [topN, setTopN] = useState(10);

  useEffect(() => {
    const m = location.hash.match(/k=([a-z0-9]+)/);
    let t = m ? m[1] : null;
    try {
      if (t) sessionStorage.setItem("queueline:admin:" + id, t);
      else t = sessionStorage.getItem("queueline:admin:" + id);
    } catch {}
    setToken(t);
    if (!t) setError("This admin link is missing its key. Open the full link you saved when you created the waitlist.");
  }, [id]);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }), [token]);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`/api/waitlists/${id}/admin`, { headers, cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) { setError(body?.message || "Couldn't load this waitlist."); return; }
    setError("");
    setData(body);
  }, [id, token, headers]);

  useEffect(() => { load(); }, [load]);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 2200); }

  async function act(action: "admit" | "unadmit" | "remove" | "restore", payload: { codes?: string[]; top?: number }, message: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/waitlists/${id}/admin/actions`, { method: "POST", headers, body: JSON.stringify({ action, ...payload }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message);
      flash(message.replace("{n}", String(body.changed)));
      await load();
    } catch (e) { flash((e as Error).message || "That didn't work."); }
    finally { setBusy(false); }
  }

  async function exportCsv() {
    const res = await fetch(`/api/waitlists/${id}/admin/export`, { headers });
    if (!res.ok) { flash("Export failed."); return; }
    const blob = await res.blob();
    const name = (res.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1] || "waitlist.csv";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const list = data.rows.filter((r) => (filter === "all" ? r.status !== "removed" || false : r.status === filter) && (!needle || r.email.includes(needle) || r.code.includes(needle)));
    const val = (r: Row) => sort.key === "position" ? (r.position ?? 1e9 + (r.statusChangedAt ?? 0) / 1e13) : sort.key === "referrals" ? r.referrals : r.joinedAt;
    return [...list].sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [data, q, filter, sort]);

  const emailByCode = useMemo(() => new Map((data?.rows || []).map((r) => [r.code, r.email])), [data]);

  if (error && !data) {
    return (
      <Shell>
        <div className="panel" style={{ maxWidth: 560, margin: "64px auto" }} role="alert">
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Can&apos;t open this dashboard</h1>
          <p style={{ color: "var(--muted)" }}>{error}</p>
        </div>
      </Shell>
    );
  }
  if (!data) return <Shell><p className="empty">Loading…</p></Shell>;

  const sortBtn = (key: SortKey, label: string) => (
    <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "position" ? 1 : -1 }))} aria-label={`Sort by ${label}`}>
      {label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </button>
  );

  return (
    <Shell>
      <div className="admin-head">
        <div>
          <h1>{data.name}</h1>
          <p className="meta">Created {new Date(data.createdAt).toLocaleDateString()} · Owner {data.ownerEmail} · {data.settings.pointsPerReferral} spots per referral</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn secondary" href={data.hostedUrl} target="_blank" rel="noopener">Signup page</a>
          <button className="btn secondary" type="button" onClick={load}>Refresh</button>
          <button className="btn" type="button" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      <div className="stats">
        <Stat n={data.stats.total} k="Signups" testid="stat-total" />
        <Stat n={data.stats.waiting} k="Waiting" testid="stat-waiting" />
        <Stat n={data.stats.admitted} k="Admitted" testid="stat-admitted" />
        <Stat n={data.stats.referrals} k="Referrals" testid="stat-referrals" />
        <div className="stat">
          <Spark daily={data.daily} />
          <div className="k">Signups per day, last 14 days</div>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Dashboard sections">
        {(["people", "share", "settings"] as Tab[]).map((t) => (
          <button key={t} role="tab" id={`tab-${t}`} aria-controls={`panel-${t}`} aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === "people" ? "People" : t === "share" ? "Share & embed" : "Settings"}
          </button>
        ))}
      </div>

      {tab === "people" && (
        <div role="tabpanel" id="panel-people" aria-labelledby="tab-people">
          <div className="toolbar">
            <label className="sr" htmlFor="search">Search</label>
            <input id="search" type="search" placeholder="Search email or code" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="sr" htmlFor="filter">Status</label>
            <select id="filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">Waiting and admitted</option>
              <option value="waiting">Waiting</option>
              <option value="admitted">Admitted</option>
              <option value="removed">Removed</option>
            </select>
            <span className="spacer" />
            <label htmlFor="topn" style={{ fontSize: 14 }}>Offer spots to the next</label>
            <input id="topn" type="number" min={1} max={1000} value={topN} onChange={(e) => setTopN(Math.max(1, Number(e.target.value) || 1))} style={{ width: 80 }} />
            <button className="btn small" type="button" disabled={busy || data.stats.waiting === 0} onClick={() => act("admit", { top: topN }, "Offered spots to {n} people")}>
              Offer spots
            </button>
          </div>
          <div className="tablewrap">
            {rows.length === 0 ? (
              <p className="empty">{data.stats.total === 0 ? "No signups yet. Share your signup page to get the first one." : "Nobody matches that."}</p>
            ) : (
              <table className="list" data-testid="people">
                <thead>
                  <tr>
                    <th className="num" scope="col">{sortBtn("position", "Position")}</th>
                    <th scope="col">Email</th>
                    <th className="num" scope="col">{sortBtn("referrals", "Referrals")}</th>
                    <th scope="col">Referred by</th>
                    <th scope="col">{sortBtn("joinedAt", "Joined")}</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span className="sr">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code} data-code={r.code}>
                      <td className="num">{r.position ?? "–"}</td>
                      <td>{r.email}</td>
                      <td className="num">{r.referrals}</td>
                      <td className="clip" title={r.referredBy ? emailByCode.get(r.referredBy) || r.referredBy : undefined}>{r.referredBy ? emailByCode.get(r.referredBy) || r.referredBy : ""}</td>
                      <td title={new Date(r.joinedAt).toISOString()}>{new Date(r.joinedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                      <td><span className={`pill ${r.status}`}>{r.status}</span></td>
                      <td><div className="acts">
                        {r.status === "waiting" && <button className="btn small" disabled={busy} onClick={() => act("admit", { codes: [r.code] }, "Spot offered")}>Offer spot</button>}
                        {r.status === "admitted" && (
                          <>
                            <a className="btn secondary small" href={offerMail(data.name, r.email)}>Email</a>
                            <button className="btn secondary small" disabled={busy} onClick={() => act("unadmit", { codes: [r.code] }, "Moved back to waiting")}>Undo</button>
                          </>
                        )}
                        {r.status !== "removed" ? (
                          <button className="btn danger small" disabled={busy} onClick={() => confirm(`Remove ${r.email} from the list?`) && act("remove", { codes: [r.code] }, "Removed")}>Remove</button>
                        ) : (
                          <button className="btn secondary small" disabled={busy} onClick={() => act("restore", { codes: [r.code] }, "Restored")}>Restore</button>
                        )}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: "10px 0 56px" }}>
            Position = join order − {data.settings.pointsPerReferral} × referrals, ties to whoever joined first. Referrals from the referrer&apos;s own network don&apos;t count. Queueline doesn&apos;t send email: use the Email button or export the admitted list to your mail tool.
          </p>
        </div>
      )}

      {tab === "share" && (
        <div role="tabpanel" id="panel-share" aria-labelledby="tab-share" className="grid2">
          <div className="panel">
            <h2>Hosted signup page</h2>
            <div className="copyrow" style={{ marginBottom: 10 }}>
              <label className="sr" htmlFor="hosted">Hosted page link</label>
              <input id="hosted" readOnly value={data.hostedUrl} />
              <CopyButton text={data.hostedUrl} />
            </div>
            <p style={{ color: "var(--muted)", fontSize: 14 }}>No website yet? Share this link directly.</p>
          </div>
          <div className="panel">
            <h2>Embed on your site</h2>
            <label className="sr" htmlFor="snippet">Embed snippet</label>
            <textarea id="snippet" readOnly className="mono" rows={3} value={data.embedSnippet} style={{ marginBottom: 10 }} />
            <CopyButton text={data.embedSnippet} label="Copy snippet" />
            <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 10 }}>
              Referral links point to {data.settings.shareUrl ? <code>{data.settings.shareUrl}</code> : "the hosted page"}. Change this in Settings.
            </p>
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div role="tabpanel" id="panel-settings" aria-labelledby="tab-settings">
          <SettingsForm data={data} headers={headers} onSaved={() => { flash("Settings saved"); load(); }} />
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </Shell>
  );
}

function SettingsForm({ data, headers, onSaved }: { data: Data; headers: Record<string, string>; onSaved: () => void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/waitlists/${data.id}/admin`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: f.get("name"),
        description: f.get("description"),
        settings: {
          pointsPerReferral: Number(f.get("points")),
          shareUrl: f.get("shareUrl") || null,
          showLeaderboard: f.get("showLeaderboard") === "on",
          hideCount: f.get("hideCount") === "on",
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setErr(body.message || "Couldn't save.");
    else onSaved();
  }
  return (
    <form className="panel" style={{ maxWidth: 640, margin: "20px 0 56px" }} onSubmit={submit}>
      <div className="field"><label htmlFor="s-name">Name</label><input id="s-name" name="name" type="text" defaultValue={data.name} required maxLength={80} /></div>
      <div className="field"><label htmlFor="s-desc">Description</label><textarea id="s-desc" name="description" defaultValue={data.description} maxLength={280} /></div>
      <div className="field"><label htmlFor="s-points">Spots gained per referral</label><input id="s-points" name="points" type="number" min={0} max={1000} defaultValue={data.settings.pointsPerReferral} /></div>
      <div className="field">
        <label htmlFor="s-share">Share URL <span className="help">(where referral links point; leave empty for the hosted page)</span></label>
        <input id="s-share" name="shareUrl" type="url" defaultValue={data.settings.shareUrl || ""} placeholder="https://acme.com" />
      </div>
      <label className="check"><input type="checkbox" name="showLeaderboard" defaultChecked={data.settings.showLeaderboard} /> Show top referrers on the signup page (emails masked)</label>
      <label className="check"><input type="checkbox" name="hideCount" defaultChecked={data.settings.hideCount} /> Hide the total number of signups</label>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn" type="submit" disabled={busy} style={{ marginTop: 8 }}>{busy ? "Saving…" : "Save settings"}</button>
    </form>
  );
}

function offerMail(name: string, email: string) {
  const subject = encodeURIComponent(`Your spot for ${name} is ready`);
  const body = encodeURIComponent(`Hi,\n\nThanks for waiting. Your spot for ${name} is ready.\n\n`);
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

function Stat({ n, k, testid }: { n: number; k: string; testid: string }) {
  return <div className="stat"><div className="n" data-testid={testid}>{n.toLocaleString()}</div><div className="k">{k}</div></div>;
}

function Spark({ daily }: { daily: { day: string; count: number }[] }) {
  const w = 280, h = 40, max = Math.max(1, ...daily.map((d) => d.count));
  const bw = w / daily.length;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`Signups per day: ${daily.map((d) => d.count).join(", ")}`}>
      {daily.map((d, i) => {
        const bh = d.count ? Math.max(2, (d.count / max) * (h - 2)) : 1;
        return <rect key={d.day} x={i * bw + 1} y={h - bh} width={bw - 2} height={bh} fill={d.count ? "#0f5c4d" : "#d9dce1"}><title>{`${d.day}: ${d.count}`}</title></rect>;
      })}
    </svg>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="wrap admin">
      <header className="top">
        <Link href="/" className="brand"><Logo /> Queueline</Link>
        <span style={{ color: "var(--muted)", fontSize: 14 }}>Admin</span>
      </header>
      <main>{children}</main>
    </div>
  );
}
