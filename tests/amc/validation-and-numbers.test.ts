import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_DECISION_BODY_BYTES,
  NAME_MAX,
  REASON_MAX,
  decisionSchema,
} from "@/lib/server/amc/public-dto";
import { formatProposalNumber, legacyFormatProposalNumber } from "@/lib/amc/proposal-number";
import { findPlaceholders, printedAmcText } from "@/lib/amc/placeholders";
import { getAmcSettingsDefaults } from "@/components/dashboard/extensions/amc/amc-settings";

/* --------------------------- client decisions --------------------------- */

test("valid answers are trimmed and accepted", () => {
  const r = decisionSchema.safeParse({ action: "sign", name: "  Maryam   Al  Falasi " });
  assert.ok(r.success);
  if (r.success) assert.equal(r.data.name, "Maryam Al Falasi");
  assert.ok(decisionSchema.safeParse({ action: "approve", name: "Jo" }).success);
  assert.ok(
    decisionSchema.safeParse({ action: "reject", name: "O'Neil-Smith", reason: "Change the dates." }).success,
  );
  // Non-Latin names are fine.
  assert.ok(decisionSchema.safeParse({ action: "sign", name: "مريم الفلاسي" }).success);
});

test("malformed answers are refused", () => {
  const bad = [
    {},
    { action: "approve" },
    { action: "approve", name: "" },
    { action: "approve", name: " a " },
    { action: "reject", name: "Jo" },
    { action: "reject", name: "Jo", reason: "  " },
    { action: "delete", name: "Jo" },
    { action: "approve", name: 42 },
    { action: "approve", name: "Jo", status: "signed" },
  ];
  for (const body of bad) {
    assert.equal(decisionSchema.safeParse(body).success, false, JSON.stringify(body));
  }
});

test("oversized answers are refused", () => {
  assert.equal(
    decisionSchema.safeParse({ action: "sign", name: "a".repeat(NAME_MAX + 1) }).success,
    false,
  );
  assert.equal(
    decisionSchema.safeParse({ action: "reject", name: "Jo", reason: "a".repeat(REASON_MAX + 1) })
      .success,
    false,
  );
  assert.ok(MAX_DECISION_BODY_BYTES <= 64 * 1024);
});

/* --------------------------- proposal numbers --------------------------- */

test("proposal numbers continue past 9999 without truncating", () => {
  assert.equal(formatProposalNumber(2026, 9998), "AMC-2026-9998");
  assert.equal(formatProposalNumber(2026, 9999), "AMC-2026-9999");
  assert.equal(formatProposalNumber(2026, 10000), "AMC-2026-10000");
  assert.equal(formatProposalNumber(2026, 10001), "AMC-2026-10001");
  assert.equal(formatProposalNumber(2026, 7), "AMC-2026-0007");
});

test("the old default would have collided at 10000", () => {
  assert.equal(legacyFormatProposalNumber(2026, 10000), "AMC-2026-1000");
  assert.equal(legacyFormatProposalNumber(2026, 10000), legacyFormatProposalNumber(2026, 1000));
  assert.notEqual(formatProposalNumber(2026, 10000), formatProposalNumber(2026, 1000));
});

/* ----------------------------- placeholders ----------------------------- */

test("placeholders are found case-insensitively, with their location", () => {
  const hits = findPlaceholders([
    { location: "A", text: "Call 05x xxx xx" },
    { location: "B", text: "xxx@tphgroup.me" },
    { location: "C", text: "All good" },
  ]);
  assert.deepEqual(
    hits.map((h) => h.location),
    ["A", "B"],
  );
});

test("hidden content does not block; printed proposal data does", () => {
  const settings = getAmcSettingsDefaults();
  settings.provider = {
    ...settings.provider,
    contactNo: "800-PERFECT",
    coordinationEmails: ["ops@tphgroup.me"],
  };
  // A switched-off clause with a placeholder must not block a contract.
  settings.clauseList = settings.clauseList.map((c, i) =>
    i === 0 ? { ...c, enabled: false, body: "XXX" } : c,
  );
  // A placeholder in a service that is not ticked must not block.
  settings.serviceScopes = { ...settings.serviceScopes, handyman: "XXX hours" };

  const proposal = {
    property: { propertyAddress: "Villa 1", propertyDetail: "" },
    customer: { customerName: "Client", coordinationContacts: [{ name: "A", phone: "0501234567" }] },
    services: [{ serviceId: "ac-ppm", included: true }],
    document_options: { accountManagers: [{ name: "Sam", phone: "0501111111" }] },
  };

  const clean = findPlaceholders(printedAmcText(settings, proposal, "contract"));
  assert.deepEqual(clean, [], JSON.stringify(clean));

  const withPlaceholder = {
    ...proposal,
    document_options: { accountManagers: [{ name: "Sam", phone: "05X XXX XXXX" }] },
  };
  const hits = findPlaceholders(printedAmcText(settings, withPlaceholder, "proposal"));
  assert.equal(hits.length, 1);
  assert.match(hits[0].location, /Account manager 1 phone/);
});

test("the shipped defaults are caught (they ship with XXX contact values)", () => {
  const defaults = getAmcSettingsDefaults();
  const hits = findPlaceholders(
    printedAmcText(defaults, { services: [], customer: {}, property: {} }, "contract"),
  );
  assert.ok(hits.some((h) => h.location.startsWith("AMC Settings > Provider")));
});
