import assert from "node:assert/strict";
import { test } from "node:test";

import { createEnquirySchema, enquiryFieldErrors } from "@/lib/amc/enquiries";

const CLIENT = "6f1c2a52-3b0e-4d7a-9c1e-2f4b5a6c7d8e";

function errorsFor(input: Record<string, unknown>) {
  const parsed = createEnquirySchema.safeParse(input);
  return parsed.success ? {} : enquiryFieldErrors(parsed.error.issues);
}

test("an empty form: the client and the need, each under its own field", () => {
  const e = errorsFor({ source: "SEO", contactName: "", contactPhone: null, contactEmail: null, contactWhatsapp: null, need: "", customerId: null, newCustomer: null });
  assert.equal(e.client, "Choose the client or add a new prospect");
  assert.equal(e.need, "Say in short what the client needs");
  /* No client yet: "no way to reach them" would only repeat the client message. */
  assert.equal(e.whatsapp, undefined);
});

test("a client with no phone or email: the message sits under WhatsApp", () => {
  const e = errorsFor({ source: "SEO", contactName: "Sara", contactPhone: null, contactEmail: null, contactWhatsapp: null, need: "Yearly AC", customerId: CLIENT });
  assert.deepEqual(e, { whatsapp: "Give a phone, WhatsApp or email for the contact" });
});

test("a referral with nobody named, and no source", () => {
  assert.equal(
    errorsFor({ source: "Referral", contactName: "Sara", contactPhone: "+971500000000", need: "Yearly AC", customerId: CLIENT }).referrer,
    "Say who referred them",
  );
  assert.equal(errorsFor({ source: "", contactName: "Sara", contactPhone: "+971500000000", need: "Yearly AC", customerId: CLIENT }).source, "Choose the source");
});

test("a valid enquiry has no errors", () => {
  assert.deepEqual(errorsFor({ source: "SEO", contactName: "Sara", contactPhone: "+971500000000", need: "Yearly AC", customerId: CLIENT }), {});
});
