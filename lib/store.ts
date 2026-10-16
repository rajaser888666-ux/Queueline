// Persistence: one JSON ledger object per waitlist, written with optimistic concurrency (ETag / ifMatch).
// Drivers: "blob" (Vercel Blob, private store) in production, "fs" for local development and tests.
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Ledger } from "./core";
import { WaitlistError } from "./core";

export interface Stored {
  ledger: Ledger;
  etag: string;
}

export class ConflictError extends Error {}

export interface Driver {
  name: string;
  read(id: string): Promise<Stored | null>;
  /** etag null = create (must not exist). Returns the new etag. Throws ConflictError on a lost race. */
  write(id: string, ledger: Ledger, etag: string | null): Promise<string>;
  remove(id: string): Promise<void>;
}

const keyFor = (id: string) => `wl/${id}.json`;

/** Blob serves larger bodies compressed with a weak ETag (W/"…"); conditional writes need the strong form. */
export const strongEtag = (etag: string) => etag.replace(/^W\//, "");

// ---------- fs driver ----------

function fsDriver(dir: string): Driver {
  const file = (id: string) => path.join(dir, keyFor(id).replace("/", "__"));
  const etagOf = (s: string) => createHash("sha1").update(s).digest("hex");
  let chain: Promise<unknown> = Promise.resolve(); // serialise writes within this process
  return {
    name: "fs",
    async read(id) {
      try {
        const s = await fs.readFile(file(id), "utf8");
        return { ledger: JSON.parse(s), etag: etagOf(s) };
      } catch (e: any) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    write(id, ledger, etag) {
      const run = async () => {
        await fs.mkdir(dir, { recursive: true });
        let current: string | null = null;
        try {
          current = await fs.readFile(file(id), "utf8");
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e;
        }
        if (etag === null && current !== null) throw new ConflictError("exists");
        if (etag !== null && (current === null || etagOf(current) !== etag)) throw new ConflictError("etag mismatch");
        const s = JSON.stringify(ledger);
        const tmp = file(id) + "." + process.pid + ".tmp";
        await fs.writeFile(tmp, s);
        await fs.rename(tmp, file(id));
        return etagOf(s);
      };
      const p = chain.then(run, run);
      chain = p.catch(() => {});
      return p;
    },
    async remove(id) {
      await fs.rm(file(id), { force: true });
    },
  };
}

// ---------- Vercel Blob driver ----------

function blobDriver(): Driver {
  // Imported lazily so local runs without a token never load it.
  const sdk = () => import("@vercel/blob");
  return {
    name: "blob",
    async read(id) {
      const { get } = await sdk();
      const res = await get(keyFor(id), { access: "private", useCache: false });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      const text = await new Response(res.stream).text();
      // Larger bodies come back compressed with a weak ETag (W/"…"); ifMatch needs the strong form.
      return { ledger: JSON.parse(text), etag: strongEtag(res.blob.etag) };
    },
    async write(id, ledger, etag) {
      const { put, BlobPreconditionFailedError } = await sdk();
      const body = JSON.stringify(ledger);
      try {
        const r = await put(keyFor(id), body, {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: etag !== null,
          ...(etag ? { ifMatch: etag } : {}),
          contentType: "application/json",
          cacheControlMaxAge: 60,
        });
        return r.etag;
      } catch (e: any) {
        if (process.env.QL_DEBUG) console.error("blob put error", e?.constructor?.name, e?.message);
        if (e instanceof BlobPreconditionFailedError) throw new ConflictError("etag mismatch");
        // Two conditional writes in flight at once: Blob answers 409 "conflicting operation". Same remedy: re-read and retry.
        if (/conflicting operation|precondition/i.test(String(e?.message))) throw new ConflictError("concurrent write");
        if (etag === null && /already exists|allowOverwrite/i.test(String(e?.message))) throw new ConflictError("exists");
        throw e;
      }
    },
    async remove(id) {
      const { del } = await sdk();
      await del(keyFor(id));
    },
  };
}

let driver: Driver | null = null;
export function getDriver(): Driver {
  if (driver) return driver;
  const want = process.env.STORE_DRIVER || (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID ? "blob" : "fs");
  driver = want === "blob" ? blobDriver() : fsDriver(process.env.STORE_DIR || path.join(process.cwd(), ".data"));
  return driver;
}
export function setDriverForTests(d: Driver | null) {
  driver = d;
  cache.clear();
}

// ---------- short-lived read cache for public, read-only views ----------
// Saves Blob operations on busy hosted pages. Never used for writes or admin views.
const cache = new Map<string, { at: number; stored: Stored | null }>();
const CACHE_MS = 15_000;

export async function readLedger(id: string, opts: { cached?: boolean } = {}): Promise<Stored | null> {
  if (opts.cached) {
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.stored;
  }
  const stored = await getDriver().read(id);
  cache.set(id, { at: Date.now(), stored });
  return stored;
}

export async function createLedger(ledger: Ledger): Promise<void> {
  await getDriver().write(ledger.id, ledger, null);
  cache.delete(ledger.id);
}

// Writes to one waitlist from the same server instance queue up instead of racing each other.
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(id: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(id) || Promise.resolve();
  const next = prev.then(job, job);
  const tail = next.catch(() => {});
  queues.set(id, tail);
  tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
  return next;
}

/** Read-modify-write with retries on concurrent writers (other instances). */
export function mutateLedger<T>(id: string, fn: (l: Ledger) => T, attempts = 10): Promise<{ ledger: Ledger; result: T }> {
  return enqueue(id, () => mutateOnce(id, fn, attempts));
}

async function mutateOnce<T>(id: string, fn: (l: Ledger) => T, attempts: number): Promise<{ ledger: Ledger; result: T }> {
  const d = getDriver();
  for (let i = 0; i < attempts; i++) {
    const stored = await d.read(id);
    if (!stored) throw new WaitlistError("not_found", "Waitlist not found.", 404);
    const result = fn(stored.ledger); // may throw WaitlistError; no write happens then
    try {
      const etag = await d.write(id, stored.ledger, stored.etag);
      cache.set(id, { at: Date.now(), stored: { ledger: stored.ledger, etag } });
      return { ledger: stored.ledger, result };
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      if (process.env.QL_DEBUG) console.error("conflict", id, i, stored.etag, (e as Error).message, (e as any).cause?.message);
      await new Promise((r) => setTimeout(r, 30 + Math.random() * Math.min(1500, 80 * 2 ** i)));
    }
  }
  throw new WaitlistError("busy", "The waitlist is busy. Please try again.", 503);
}
