import assert from "node:assert/strict";
import test from "node:test";

import { clientReportCategory } from "@/lib/amc/proposal-rules";

/* DEV-410 (20 Nov 2026 review): the commercial opening for shops, clinics and restaurants, not only offices. */
test("every commercial property gets the commercial opening", () => {
  for (const propertyType of ["shop", "clinic", "restaurant", "warehouse", "office"]) {
    assert.equal(clientReportCategory({ propertyType, unitType: "office" }), "commercial", propertyType);
    assert.equal(clientReportCategory({ propertyType, unitType: null }), "commercial", `${propertyType} with no unit type`);
  }
  for (const propertyType of ["villa", "apartment", "townhouse"]) assert.equal(clientReportCategory({ propertyType }), "residential", propertyType);
});

test("the contract template and the property category decide first", () => {
  assert.equal(clientReportCategory({ template: "residential", propertyType: "shop" }), "residential");
  assert.equal(clientReportCategory({ propertyCategory: "commercial", propertyType: "other" }), "commercial");
  assert.equal(clientReportCategory({ unitType: "shop" }), "commercial", "a full type kept as the unit type");
  assert.equal(clientReportCategory({ unitType: "office" }), "commercial");
  assert.equal(clientReportCategory({ unitType: "villa" }), "residential");
});
