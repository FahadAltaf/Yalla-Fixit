import { test } from "node:test";
import assert from "node:assert/strict";

import { hashLinkToken, mintLinkToken } from "@/lib/server/link-token";
import { resolveLink, type LinkRow } from "@/lib/server/amc/link-resolution";

const NOW = Date.parse("2026-10-05T10:00:00Z");
const FUTURE = "2026-11-04T10:00:00Z";
const PAST = "2026-10-04T10:00:00Z";

/* A one-table fake of the lookup the route makes. */
function fakeTable(rows: LinkRow[]) {
  return async (hash: string) =>
    rows.find((r) => r.proposal_token_hash === hash || r.contract_token_hash === hash) ?? null;
}

function rowWith(status: string, proposal?: string, contract?: string, expiry = FUTURE): LinkRow {
  return {
    id: "row-1",
    status,
    proposal_token_hash: proposal ? hashLinkToken(proposal) : null,
    contract_token_hash: contract ? hashLinkToken(contract) : null,
    proposal_token_expires_at: proposal ? expiry : null,
    contract_token_expires_at: contract ? expiry : null,
  };
}

test("a valid proposal link waiting for an answer is open", async () => {
  const t = mintLinkToken();
  const r = await resolveLink(t.raw, fakeTable([rowWith("proposal_sent", t.raw)]), NOW);
  assert.equal(r.state, "open");
  /* assert.equal above narrows r to an open link, so its kind is there to check. */
  assert.equal(r.kind, "proposal");
});

test("only the hash is stored, and it is SHA-256 hex", () => {
  const t = mintLinkToken();
  assert.match(t.hash, /^[0-9a-f]{64}$/);
  assert.notEqual(t.hash, t.raw);
  assert.equal(t.raw.length, 43);
});

test("invalid tokens: too short, too long, unknown", async () => {
  const table = fakeTable([rowWith("proposal_sent", mintLinkToken().raw)]);
  assert.equal((await resolveLink("short", table, NOW)).state, "not_found");
  assert.equal((await resolveLink("x".repeat(300), table, NOW)).state, "not_found");
  assert.equal((await resolveLink(mintLinkToken().raw, table, NOW)).state, "not_found");
});

test("an expired link is refused", async () => {
  const t = mintLinkToken();
  const r = await resolveLink(t.raw, fakeTable([rowWith("proposal_sent", t.raw, undefined, PAST)]), NOW);
  assert.equal(r.state, "expired");
});

test("a consumed proposal link (after approval or rejection) is closed", async () => {
  const t = mintLinkToken();
  for (const status of ["proposal_approved", "proposal_rejected"]) {
    const r = await resolveLink(t.raw, fakeTable([rowWith(status, t.raw)]), NOW);
    assert.equal(r.state, "closed", status);
  }
});

test("a superseded link (re-sent, hash replaced) is not found", async () => {
  const oldToken = mintLinkToken();
  const newToken = mintLinkToken();
  const table = fakeTable([rowWith("proposal_sent", newToken.raw)]);
  assert.equal((await resolveLink(oldToken.raw, table, NOW)).state, "not_found");
  assert.equal((await resolveLink(newToken.raw, table, NOW)).state, "open");
});

test("a proposal link does not work as a contract link once the contract is out", async () => {
  const proposal = mintLinkToken();
  const contract = mintLinkToken();
  const table = fakeTable([rowWith("contract_sent", proposal.raw, contract.raw)]);
  const p = await resolveLink(proposal.raw, table, NOW);
  assert.equal(p.state, "closed");
  assert.equal(p.kind, "proposal");
  const c = await resolveLink(contract.raw, table, NOW);
  assert.equal(c.state, "open");
  assert.equal(c.kind, "contract");
});

test("a contract link is closed after signature", async () => {
  const contract = mintLinkToken();
  const r = await resolveLink(contract.raw, fakeTable([rowWith("signed", undefined, contract.raw)]), NOW);
  assert.equal(r.state, "closed");
});

test("a proposal link is closed while the proposal is being revised", async () => {
  const t = mintLinkToken();
  for (const status of ["draft", "awaiting_approval", "approved", "sent_back"]) {
    const r = await resolveLink(t.raw, fakeTable([rowWith(status, t.raw)]), NOW);
    assert.equal(r.state, "closed", status);
  }
});
