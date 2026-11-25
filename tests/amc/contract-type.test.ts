import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_TYPES, contractTypeLabel, parseContractType } from "@/lib/amc/contract-type";

/* DEV-500 (BRD v0.4 5.4): each proposal carries a contract type, shown in the contract heading and read from the tracker. */
test("the three types and their labels", () => {
  assert.deepEqual([...CONTRACT_TYPES], ["comprehensive", "semi_comprehensive", "non_comprehensive"]);
  assert.equal(contractTypeLabel("semi_comprehensive"), "Semi-Comprehensive");
  assert.equal(contractTypeLabel(undefined), null, "a proposal from before has none");
  assert.equal(contractTypeLabel("gold"), null);
});

test("the tracker's wording is read as a type", () => {
  assert.equal(parseContractType("Comprehensive"), "comprehensive");
  assert.equal(parseContractType("Semi Comprehensive"), "semi_comprehensive");
  assert.equal(parseContractType("semi-comp"), "semi_comprehensive");
  assert.equal(parseContractType("Non-Comprehensive"), "non_comprehensive");
  assert.equal(parseContractType("non comp"), "non_comprehensive");
  assert.equal(parseContractType(""), null);
  assert.equal(parseContractType("Gold"), null);
});
