import { test } from "node:test";
import assert from "node:assert/strict";

import { invoiceEmailHtml, invoiceEmailRequestSchema, invoiceEmailSubject, isEmail, splitEmails } from "@/lib/finance/invoice-email";
import { planEmail } from "@/lib/server/finance/delivery-policy";

const facts = { invoiceNumber: "YFI-00012149", invoiceDate: "2026-11-05", maherTotal: 2716.35, workOrderNumber: "WO3391", clientName: "CSI BLACK INVESTMENT LLC" };

test("addresses typed into one box: split on commas, semicolons and spaces, lower-cased, de-duplicated", () => {
  assert.deepEqual(splitEmails(" A@x.com, b@y.ae;  a@X.com c@z.com "), ["a@x.com", "b@y.ae", "c@z.com"]);
  assert.deepEqual(splitEmails(""), []);
  assert.equal(isEmail("finance@client.ae"), true);
  assert.equal(isEmail("not an email"), false);
});

test("the request needs at least one client address and at most ten", () => {
  assert.equal(invoiceEmailRequestSchema.safeParse({ to: [] }).success, false);
  assert.equal(invoiceEmailRequestSchema.safeParse({ to: ["bad"] }).success, false);
  const ok = invoiceEmailRequestSchema.safeParse({ to: ["Client@Example.com"], message: "  Thanks  " });
  assert.ok(ok.success);
  assert.deepEqual(ok.data.to, ["client@example.com"]);
  assert.deepEqual(ok.data.cc, []);
  assert.equal(invoiceEmailRequestSchema.safeParse({ to: Array.from({ length: 11 }, (_, i) => `c${i}@x.com`) }).success, false);
});

test("subject and body: invoice number, date, MAHER total and work order; Finance's message escaped", () => {
  assert.equal(invoiceEmailSubject(facts), "Invoice YFI-00012149 for work order WO3391 | Yalla Fix It");
  const html = invoiceEmailHtml({ ...facts, message: "Hello <b>team</b>\n\nSecond paragraph" });
  assert.match(html, /Dear CSI BLACK INVESTMENT LLC,/);
  assert.match(html, /5 November 2026/);
  assert.match(html, /AED 2,716\.35/);
  assert.match(html, /WO3391/);
  assert.match(html, /Hello &lt;b&gt;team&lt;\/b&gt;/, "the message is escaped");
  assert.ok(!html.includes("Test copy"), "no test banner when live");
  const noAmount = invoiceEmailHtml({ ...facts, maherTotal: null });
  assert.ok(!noAmount.includes("AED"), "no amount when Finance did not enter the MAHER total");
});

test("outside live the invoice goes to the test inbox only, saying who it was for; with nothing set, nowhere", () => {
  const live = planEmail({ to: ["client@x.com", "copy@x.com"], subject: "Invoice" }, { FINANCE_NOTIFY_LIVE: "on" } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(live, { send: true, to: ["client@x.com", "copy@x.com"], subject: "Invoice", redirectedFrom: null });
  const test1 = planEmail({ to: ["client@x.com"], subject: "Invoice" }, { NOTIFY_REDIRECT_TO: "dev@yfi.ae" } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(test1, { send: true, to: ["dev@yfi.ae"], subject: "[DEV] Invoice", redirectedFrom: ["client@x.com"] });
  assert.match(invoiceEmailHtml(facts, { redirectedFrom: ["client@x.com"] }), /Test copy[\s\S]*client@x\.com/);
  assert.equal(planEmail({ to: ["client@x.com"], subject: "Invoice" }, {} as unknown as NodeJS.ProcessEnv).send, false);
});
