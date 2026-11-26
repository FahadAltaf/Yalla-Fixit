import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/* DEV-494 on site visits (26 Nov 2026): the client's pass upload link, and the Access buttons shown once. */
const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

test("the link table takes site visits (live-safe migration)", () => {
  const sql = read("supabase/migrations/20261126110000_amc_client_links_site_visits.sql").split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(sql, /CHECK \(entity_type IN \('visit', 'assessment'\)\)/);
  assert.doesNotMatch(sql, /\bDROP TABLE\b|\bDELETE FROM\b|\bUPDATE\b/i);
});

test("a site visit link uploads to the site visit, tells whoever booked it, and cannot confirm a visit", () => {
  const src = read("lib/server/amc/client-links.ts");
  const make = src.slice(src.indexOf("export async function createSiteVisitClientLink"));
  assert.match(make, /entity_type: "assessment"/);
  assert.match(make, /purpose: "access_upload"/);
  assert.match(make, /already completed/, "no link for a finished site visit");
  const upload = src.slice(src.indexOf("export async function uploadVisitPass"));
  assert.match(upload, /level: "site_visit"/);
  assert.match(upload, /category: "Gate pass"/, "it shows among the site visit's passes");
  assert.match(src, /link\.purpose !== "visit_confirmation" \|\| link\.entity_type === "assessment"/);
  assert.match(src, /tell: \[\.\.\.new Set\(\[a\.createdBy, enquiryOwner\]/);
});

test("the Access card shows Add rule / Add pass once, with Ask client for pass on a site visit; the link can be copied alone", () => {
  for (const f of ["components/dashboard/extensions/amc-contracts/access-card.tsx", "components/dashboard/extensions/amc-contracts/visit-sections.tsx"]) {
    const src = read(f);
    const empty = src.slice(src.indexOf('title="Nothing needed for access"') - 200, src.indexOf('title="Nothing needed for access"') + 250);
    assert.doesNotMatch(empty, /Add pass|Add rule/, `${f}: no second set of buttons in the empty box`);
  }
  assert.match(read("components/dashboard/extensions/amc-contracts/access-card.tsx"), /<ClientLinkButton siteVisitId=\{assessmentId\} purpose="access_upload" label="Ask client for pass"/);
  const button = read("components/dashboard/extensions/amc-contracts/client-link-button.tsx");
  assert.match(button, /Copy link/);
  assert.match(button, /\/api\/amc-contracts\/assessments\/\$\{encodeURIComponent\(siteVisitId\)\}\/client-link/);
});
