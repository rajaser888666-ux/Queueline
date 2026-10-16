import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_SETTINGS, WaitlistError, addSignup, type Ledger } from "@/lib/core";
import { ConflictError, createLedger, getDriver, mutateLedger, readLedger, setDriverForTests, strongEtag, type Driver } from "@/lib/store";

const dir = mkdtempSync(path.join(tmpdir(), "ql-store-"));
beforeAll(() => {
  process.env.STORE_DRIVER = "fs";
  process.env.STORE_DIR = dir;
  setDriverForTests(null);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const base = (id: string): Ledger => ({ v: 1, id, name: "S", description: "", ownerEmail: "o@x.com", adminHash: "h", createdAt: 1, settings: { ...DEFAULT_SETTINGS }, signups: [] });

describe("fs store", () => {
  it("creates once and refuses a second create", async () => {
    await createLedger(base("store00001"));
    await expect(createLedger(base("store00001"))).rejects.toBeInstanceOf(ConflictError);
    expect((await readLedger("store00001"))!.ledger.name).toBe("S");
  });
  it("returns null for missing", async () => expect(await readLedger("missing0001")).toBeNull());
  it("rejects stale etags", async () => {
    await createLedger(base("store00002"));
    const d = getDriver();
    const s = (await d.read("store00002"))!;
    await d.write("store00002", { ...s.ledger, name: "A" }, s.etag);
    await expect(d.write("store00002", { ...s.ledger, name: "B" }, s.etag)).rejects.toBeInstanceOf(ConflictError);
  });
  it("mutateLedger doesn't lose concurrent signups", async () => {
    await createLedger(base("store00003"));
    let n = 0;
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        mutateLedger("store00003", (l) => addSignup(l, { email: `p${i}@x.com`, ipHash: `ip${i}`, now: i, source: "api", newCode: () => `code${i}x${n++}`, newKey: () => "k".repeat(20) })),
      ),
    );
    expect((await readLedger("store00003"))!.ledger.signups).toHaveLength(20);
  });
  it("mutateLedger 404s for unknown waitlists and doesn't write on validation errors", async () => {
    await expect(mutateLedger("nothere001", () => 1)).rejects.toMatchObject({ code: "not_found" });
    await createLedger(base("store00004"));
    await expect(mutateLedger("store00004", (l) => { l.name = "changed"; throw new WaitlistError("x", "x"); })).rejects.toBeInstanceOf(WaitlistError);
    expect((await readLedger("store00004"))!.ledger.name).toBe("S");
  });
});

describe("retry behaviour", () => {
  it("retries on conflict then gives up with 'busy'", async () => {
    let writes = 0;
    const stub: Driver = {
      name: "stub",
      read: async () => ({ ledger: base("stub000001"), etag: "e" }),
      write: async () => { writes++; throw new ConflictError("always"); },
      remove: async () => {},
    };
    setDriverForTests(stub);
    await expect(mutateLedger("stub000001", () => 1, 3)).rejects.toMatchObject({ code: "busy", status: 503 });
    expect(writes).toBe(3);
    setDriverForTests(null);
  });
});

describe("etag handling", () => {
  it("turns Blob's weak ETags (compressed reads) into strong ones for ifMatch", () => {
    expect(strongEtag('W/"5928aba02a2301a71cfbb50c4ab4c1b8"')).toBe('"5928aba02a2301a71cfbb50c4ab4c1b8"');
    expect(strongEtag('"abc"')).toBe('"abc"');
  });
  it("queues same-instance writers so a burst needs no retries", async () => {
    let reads = 0, writes = 0, etag = 0;
    let ledgerState = base("queue00001");
    const stub: Driver = {
      name: "stub",
      read: async () => { reads++; return { ledger: structuredClone(ledgerState), etag: String(etag) }; },
      write: async (_id, l, e) => { writes++; if (e !== String(etag)) throw new ConflictError("x"); await new Promise((r) => setTimeout(r, 5)); ledgerState = l; etag++; return String(etag); },
      remove: async () => {},
    };
    setDriverForTests(stub);
    await Promise.all(Array.from({ length: 8 }, (_, i) => mutateLedger("queue00001", (l) => { l.description += i; })));
    expect(writes).toBe(8);
    expect(reads).toBe(8);
    expect(ledgerState.description.length).toBe(8);
    setDriverForTests(null);
  });
});
