import assert from "node:assert/strict";
import test from "node:test";

import { AMC_CONFIG_DEFAULTS } from "@/lib/amc/config";
import { answerVisitConfirmation, resolveClientLink, uploadVisitPass } from "@/lib/server/amc/client-links";
import { hashLinkToken } from "@/lib/server/link-token";
import { fakeSupabase } from "./fake-supabase";

/* DEV-507 / DEV-494 (22 Nov 2026): client links without a login; only the hash is stored, links expire and are replaced. */
const raw = (n: string) => `tok_${n}`.padEnd(43, "x");
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

function seed() {
  return fakeSupabase({
    amc_client_links: [
      { id: "l1", purpose: "visit_confirmation", entity_type: "visit", entity_id: "v1", channel: "whatsapp", token_hash: hashLinkToken(raw("ok")), expires_at: future, revoked_at: null },
      { id: "l2", purpose: "visit_confirmation", entity_type: "visit", entity_id: "v1", channel: "whatsapp", token_hash: hashLinkToken(raw("old")), expires_at: future, revoked_at: past },
      { id: "l3", purpose: "access_upload", entity_type: "visit", entity_id: "v1", channel: "email", token_hash: hashLinkToken(raw("late")), expires_at: past, revoked_at: null },
    ],
  });
}

test("a link works only while it is the latest and not expired; the raw token is never stored", async () => {
  const w = seed();
  assert.equal((await resolveClientLink(w.client as never, raw("ok"))).link?.id, "l1");
  assert.equal((await resolveClientLink(w.client as never, raw("old"))).problem, "revoked");
  assert.equal((await resolveClientLink(w.client as never, raw("late"))).problem, "expired");
  assert.equal((await resolveClientLink(w.client as never, raw("nope"))).problem, "not_found");
  assert.equal((await resolveClientLink(w.client as never, "short")).problem, "not_found", "malformed tokens are not looked up");
  assert.ok(w.table("amc_client_links").every((l) => !Object.values(l).includes(raw("ok"))));
});

test("each link does only its own job", async () => {
  const w = seed();
  const confirmLink = w.table("amc_client_links")[0];
  await assert.rejects(
    () => uploadVisitPass(w.client as never, confirmLink, { bytes: new Uint8Array([1]), fileName: "a.pdf" }, { name: "Client" }, AMC_CONFIG_DEFAULTS),
    (e: { status?: number }) => e.status === 400,
  );
  const uploadLink = { ...confirmLink, purpose: "access_upload" };
  await assert.rejects(() => answerVisitConfirmation(w.client as never, uploadLink, { answer: "confirm", name: "Client" }, AMC_CONFIG_DEFAULTS), (e: { status?: number }) => e.status === 400);
});
