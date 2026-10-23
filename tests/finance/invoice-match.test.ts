import { test } from "node:test";
import assert from "node:assert/strict";

import { matchInvoice, referenceKey, scannedReferences, type CandidateLine, type ScannedInvoice } from "@/lib/finance/invoice-match";

const cand = (lineId: string, name: string, amount: number, remaining = amount, wo = "WO3546", q: string | null = null): CandidateLine => ({
  workOrderId: `id-${wo}`,
  workOrderNumber: wo,
  quotationNumber: q,
  lineId,
  name,
  description: null,
  amount,
  amountWithVat: null,
  remaining,
});
const invoice = (lines: ScannedInvoice["lines"], references: string[] = []): ScannedInvoice => ({
  invoiceNumber: "M-1",
  invoiceDate: "2026-10-22",
  currency: "AED",
  subtotal: null,
  vat: null,
  total: null,
  references,
  lines,
});
const line = (description: string, amount: number | null, reference: string | null = null) => ({ description, quantity: 1, unitPrice: amount, amount, reference });

test("work order and quotation numbers are read however they are written", () => {
  assert.equal(referenceKey("WO3546"), "3546");
  assert.equal(referenceKey("WO-3546"), "3546");
  assert.equal(referenceKey("work order 3546"), "3546");
  assert.equal(referenceKey("18053"), "18053");
  assert.equal(referenceKey("n/a"), null);
  assert.deepEqual(scannedReferences(invoice([line("x", 1, "WO 3546")], ["Quotation 18053"])).sort(), ["18053", "3546"]);
});

test("a line naming its work order, with the line's amount, is a confident match", () => {
  const { proposals, unmatched } = matchInvoice(invoice([line("Plumbing works", 375, "WO3546")]), [
    cand("L1", "Plumbing", 375),
    cand("L2", "Electrical", 99),
  ]);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].candidate.lineId, "L1");
  assert.equal(proposals[0].amount, 375);
  assert.equal(proposals[0].confidence, "high");
  assert.deepEqual(unmatched, []);
});

test("an amount with 5 % VAT is proposed without it", () => {
  const { proposals } = matchInvoice(invoice([line("Plumbing", 393.75)], ["WO3546"]), [cand("L1", "Plumbing", 375)]);
  assert.equal(proposals[0].amount, 375);
  assert.ok(proposals[0].reasons.some((r) => r.includes("VAT")));
});

test("a smaller amount is proposed as a partial invoice, never beyond what is left", () => {
  const partial = matchInvoice(invoice([line("Deep cleaning data centre", 220500)], ["WO3181"]), [
    cand("L9", "Final/Deep cleaning works for the Data Centre", 441000, 441000, "WO3181"),
  ]);
  assert.equal(partial.proposals[0].amount, 220500);
  const capped = matchInvoice(invoice([line("Plumbing", 375)], ["WO3546"]), [cand("L1", "Plumbing", 375, 187.5)]);
  assert.equal(capped.proposals[0].amount, 187.5, "the line's full amount, but only 187.50 is left");
});

test("each line is used once; a line naming another work order is never matched here; weak guesses are left to the person", () => {
  const { proposals, unmatched } = matchInvoice(
    invoice([line("Plumbing", 375, "WO3546"), line("Plumbing again", 375, "WO3546"), line("Painting", 500, "WO9999"), line("Misc", 12)]),
    [cand("L1", "Plumbing", 375), cand("L2", "Electrical", 99)],
  );
  assert.deepEqual(
    proposals.map((p) => [p.scannedIndex, p.candidate.lineId]),
    [[0, "L1"]],
  );
  assert.deepEqual(unmatched, [1, 2, 3]);
});

test("a fully invoiced line is never proposed", () => {
  const { proposals } = matchInvoice(invoice([line("Plumbing", 375, "WO3546")]), [cand("L1", "Plumbing", 375, 0)]);
  assert.equal(proposals.length, 0);
});
