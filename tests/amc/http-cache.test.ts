import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { amcFetchJson, amcFresh, amcRefresh, amcRequest, clearAmcCache } from "@/lib/amc/http-cache";

/* A fake fetch that counts calls per "METHOD url" and answers { url, n }. */
let calls: string[] = [];
let failNext = false;
let gate: Promise<void> | null = null;

beforeEach(() => {
  calls = [];
  failNext = false;
  gate = null;
  clearAmcCache();
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${(init?.method ?? "GET").toUpperCase()} ${String(url)}`;
    calls.push(key);
    if (gate) await gate;
    const status = failNext ? 500 : 200;
    failNext = false;
    return new Response(JSON.stringify(status === 200 ? { url: String(url), n: calls.length } : { error: "Boom" }), { status });
  }) as typeof fetch;
});

const gets = () => calls.filter((c) => c.startsWith("GET ")).length;

test("the same read asked twice at once makes one request", async () => {
  let open!: () => void;
  gate = new Promise((r) => (open = r));
  const a = amcRequest("/api/amc-contracts/properties/p1");
  const b = amcRequest("/api/amc-contracts/properties/p1");
  open();
  assert.deepEqual(await a, await b);
  assert.equal(gets(), 1);
});

test("a read answered a moment ago comes from memory", async () => {
  await amcRequest("/api/amc-contracts/properties/p1");
  await amcRequest("/api/amc-contracts/properties/p1");
  assert.equal(gets(), 1);
});

test("different addresses are different reads", async () => {
  await amcRequest("/api/amc-contracts/properties/p1");
  await amcRequest("/api/amc-contracts/properties/p2");
  assert.equal(gets(), 2);
});

test("a write drops the cached records", async () => {
  await amcRequest("/api/amc-contracts/properties/p1");
  await amcRequest("/api/amc-enquiries/e1/site-visit", { method: "POST", body: "{}" });
  await amcRequest("/api/amc-contracts/properties/p1");
  assert.equal(gets(), 2);
});

test("a failed write still drops the cached records", async () => {
  await amcRequest("/api/amc-contracts/properties/p1");
  failNext = true;
  await assert.rejects(amcRequest("/api/amc-contracts/properties/p1", { method: "PATCH", body: "{}" }), /Boom/);
  await amcRequest("/api/amc-contracts/properties/p1");
  assert.equal(gets(), 2);
});

test("stable lists survive an ordinary save but not a settings save", async () => {
  await amcRequest("/api/amc-enquiries/meta");
  await amcRequest("/api/amc-contracts/assessments/a1", { method: "PATCH", body: "{}" });
  await amcRequest("/api/amc-enquiries/meta");
  assert.equal(gets(), 1, "kept through a site visit save");
  await amcRequest("/api/amc-config", { method: "PUT", body: "{}" });
  await amcRequest("/api/amc-enquiries/meta");
  assert.equal(gets(), 2, "dropped by a configuration save");
});

test("a stable list is dropped by a write in its own area", async () => {
  await amcRequest("/api/amc-contracts/assessments/book");
  await amcRequest("/api/amc-contracts/assessments/book", { method: "POST", body: "{}" });
  await amcRequest("/api/amc-contracts/assessments/book");
  assert.equal(gets(), 2);
});

test("amcFresh skips the cache for the reads it starts", async () => {
  await amcRequest("/api/amc-contracts/properties/p1");
  await amcFresh(() => amcRequest("/api/amc-contracts/properties/p1"));
  assert.equal(gets(), 2);
});

test("Refresh clears everything", async () => {
  await amcRequest("/api/amc-enquiries/meta");
  let reloaded = false;
  amcRefresh(() => (reloaded = true));
  assert.ok(reloaded);
  await amcRequest("/api/amc-enquiries/meta");
  assert.equal(gets(), 2);
});

test("failures are not kept", async () => {
  failNext = true;
  await assert.rejects(amcRequest("/api/amc-contracts/properties/p1"), /Boom/);
  await amcRequest("/api/amc-contracts/properties/p1");
  assert.equal(gets(), 2);
});

test("a read that was on its way during a save is not stored", async () => {
  let open!: () => void;
  gate = new Promise((r) => (open = r));
  const read = amcFetchJson("/api/amc-contracts/properties/p1");
  const write = amcFetchJson("/api/amc-contracts/properties/p1", { method: "PATCH", body: "{}" });
  open();
  await Promise.all([read, write]);
  gate = null;
  await amcRequest("/api/amc-contracts/properties/p1");
  assert.equal(gets(), 2);
});
