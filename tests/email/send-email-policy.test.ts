import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_HTML_CHARS,
  checkEmailRequest,
  companyDomains,
  safePdfFilename,
} from "@/lib/server/email-request-policy";
import { internalRequestHeaders, verifyInternalRequest } from "@/lib/internal-signature";

const DOMAINS = ["yallafixit.ae"];
const PDF = Buffer.from("%PDF-1.7\n%test").toString("base64");
const NOT_PDF = Buffer.from("<html>not a pdf</html>").toString("base64");

const base = { subject: "Hello", html: "<p>Hi</p>" };

test("a signed-in user may email a customer, with copies and a PDF", () => {
  const r = checkEmailRequest(
    {
      ...base,
      to: "customer@example.com",
      cc: ["a@example.com", "b@example.com"],
      attachment: { filename: "Quotation-123.pdf", content: PDF, contentType: "application/pdf" },
    },
    "trusted",
    DOMAINS,
  );
  assert.ok(r.ok);
});

test("anonymous callers cannot relay to the outside world", () => {
  const r = checkEmailRequest({ ...base, to: "victim@example.com" }, "anonymous", DOMAINS);
  assert.equal(r.ok ? null : r.status, 403);
});

test("anonymous callers may notify one company mailbox, nothing more", () => {
  assert.ok(checkEmailRequest({ ...base, to: "owner@yallafixit.ae" }, "anonymous", DOMAINS).ok);
  const multi = checkEmailRequest(
    { ...base, to: ["owner@yallafixit.ae", "x@yallafixit.ae"] },
    "anonymous",
    DOMAINS,
  );
  assert.equal(multi.ok, false);
  const withCc = checkEmailRequest(
    { ...base, to: "owner@yallafixit.ae", cc: ["victim@example.com"] },
    "anonymous",
    DOMAINS,
  );
  assert.equal(withCc.ok, false);
  const withFile = checkEmailRequest(
    {
      ...base,
      to: "owner@yallafixit.ae",
      attachment: { filename: "a.pdf", content: PDF, contentType: "application/pdf" },
    },
    "anonymous",
    DOMAINS,
  );
  assert.equal(withFile.ok, false);
  // Lookalike domains do not pass.
  assert.equal(
    checkEmailRequest({ ...base, to: "owner@yallafixit.ae.evil.com" }, "anonymous", DOMAINS).ok,
    false,
  );
});

test("malformed recipients and payloads are refused with 400", () => {
  const bad = [
    { ...base, to: "not-an-email" },
    { ...base },
    { ...base, to: "a@example.com", subject: "" },
    { ...base, to: "a@example.com", html: "x".repeat(MAX_HTML_CHARS + 1) },
    { ...base, to: "a@example.com", from: "spoof@example.com" },
    { ...base, to: "a@example.com", attachment: { filename: "a.pdf", content: PDF, contentType: "text/html" } },
    { ...base, to: "a@example.com", attachment: { filename: "a.pdf", content: NOT_PDF, contentType: "application/pdf" } },
  ];
  for (const body of bad) {
    const r = checkEmailRequest(body, "trusted", DOMAINS);
    assert.equal(r.ok ? null : r.status, 400, JSON.stringify(body).slice(0, 120));
  }
});

test("attachment names are cleaned, not refused", () => {
  assert.equal(safePdfFilename("Quotation_QT#12&3,4.pdf"), "Quotation_QT_12_3_4.pdf");
  assert.equal(safePdfFilename("../../etc/passwd"), "passwd.pdf");
  assert.equal(safePdfFilename("a.exe"), "a.exe.pdf");
  assert.equal(safePdfFilename("عرض.pdf"), "_.pdf");
  assert.equal(safePdfFilename(".pdf"), "document.pdf");
  const r = checkEmailRequest(
    { ...base, to: "c@example.com", attachment: { filename: "Quotation #7.pdf", content: PDF, contentType: "application/pdf" } },
    "trusted",
    DOMAINS,
  );
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.request.attachment?.filename, "Quotation _7.pdf");
});

test("anonymous notifications may reach a subdomain of a company domain", () => {
  assert.ok(checkEmailRequest({ ...base, to: "owner@mail.yallafixit.ae" }, "anonymous", DOMAINS).ok);
  assert.equal(checkEmailRequest({ ...base, to: "owner@notyallafixit.ae" }, "anonymous", DOMAINS).ok, false);
});

test("company domains come from the sender address", () => {
  assert.deepEqual(companyDomains("Yalla Fix It <noreply@yallafixit.ae>", ""), ["yallafixit.ae"]);
  assert.deepEqual(companyDomains("noreply@yallafixit.ae", "tphgroup.me, "), ["yallafixit.ae", "tphgroup.me"]);
  assert.deepEqual(companyDomains(undefined, undefined), []);
});

test("internal signatures: valid, wrong key, wrong purpose, stale", async () => {
  const key = "test-service-role-key";
  const now = Date.parse("2026-10-05T10:00:00Z");
  const headers = new Headers(await internalRequestHeaders("send-email", now, key));
  assert.equal(await verifyInternalRequest(headers, "send-email", now, key), true);
  assert.equal(await verifyInternalRequest(headers, "send-email", now, "other-key"), false);
  assert.equal(await verifyInternalRequest(headers, "other-purpose", now, key), false);
  assert.equal(await verifyInternalRequest(headers, "send-email", now + 10 * 60 * 1000, key), false);
  assert.equal(await verifyInternalRequest(new Headers(), "send-email", now, key), false);
  // Without a key nothing is signed and nothing verifies.
  assert.deepEqual(await internalRequestHeaders("send-email", now, undefined), {});
  assert.equal(await verifyInternalRequest(headers, "send-email", now, undefined), false);
});
