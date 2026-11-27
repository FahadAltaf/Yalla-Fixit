import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
  27 Nov 2026: a call out's and additional work's Access had no client link
  for passes and access rules, as a planned visit and a site visit have.
*/
const read = (p: string) => readFileSync(p, "utf8");

test("call outs and additional work have the client's pass link", () => {
  const sql = read("supabase/migrations/20261127120000_amc_client_links_field_work.sql");
  assert.match(sql, /entity_type IN \('visit', 'assessment', 'call_out', 'additional_work'\)/);
  const links = read("lib/server/amc/client-links.ts");
  assert.match(links, /export async function createFieldWorkClientLink/);
  for (const fn of ["clientLinkView", "tellCoordinator", "passTarget"]) {
    assert.match(links, new RegExp(`function ${fn}\([\s\S]*?isFieldWork\(link\.entity_type\)`), `${fn} handles a call out and additional work`);
  }
  assert.match(links, /link\.entity_type !== "visit"\) throw new ContractError\("This link is not for confirming a visit\."/, "only a planned visit is confirmed on a link");
  assert.match(read("components/dashboard/extensions/amc-contracts/field-work-panels.tsx"), /<ClientLinkButton fieldWork=\{\{ kind, id \}\} purpose="access_upload"/);
});
