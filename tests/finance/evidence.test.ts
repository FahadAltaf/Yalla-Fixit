import { test } from "node:test";
import assert from "node:assert/strict";

import { evidenceContentType, evidenceFileName, evidencePrefix, safeEvidenceName } from "@/lib/finance/evidence";

test("evidence type comes from the browser, or from the extension when the browser leaves it empty", () => {
  assert.equal(evidenceContentType("contract.pdf", "application/pdf"), "application/pdf");
  assert.equal(evidenceContentType("Client reply.msg", ""), "application/vnd.ms-outlook");
  assert.equal(evidenceContentType("photo.JPEG", ""), "image/jpeg");
  assert.equal(evidenceContentType("setup.exe", "application/x-msdownload"), null);
  assert.equal(evidenceContentType("noextension", ""), null);
});

test("stored names keep a safe alphabet and the original name reads back", () => {
  assert.equal(safeEvidenceName("AMC contract (page 3).pdf"), "AMC_contract_page_3.pdf");
  assert.equal(safeEvidenceName("../../etc/passwd"), ".etcpasswd");
  assert.equal(safeEvidenceName("عقد.pdf"), ".pdf");
  assert.equal(safeEvidenceName("***"), "file");
  assert.ok(!safeEvidenceName("final..v2...pdf").includes(".."));
  const item = "2b1f8f3e-8a51-4a0e-9a4b-0f6f2c1d9e77";
  const path = `${evidencePrefix(item)}c0ffee00-1111-4222-8333-444455556666-AMC_contract.pdf`;
  assert.equal(evidenceFileName(path), "AMC_contract.pdf");
});
