import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { embeddedClient, embeddedProperty, snaggingPropertyType } from "@/lib/server/amc/business";

/* AMC on Snagging's clients and addresses (20261007170000). */

test("an AMC unit type maps onto Snagging's four property types", () => {
  assert.equal(snaggingPropertyType({ unitType: "villa" }), "villa");
  assert.equal(snaggingPropertyType({ unitType: "apartment" }), "apartment");
  assert.equal(snaggingPropertyType({ unitType: "townhouse" }), "townhouse");
  assert.equal(snaggingPropertyType({ unitType: "clinic" }), "commercial");
  assert.equal(snaggingPropertyType({ unitType: "office" }), "commercial");
  assert.equal(snaggingPropertyType({ unitType: null, propertyCategory: "commercial" }), "commercial");
  assert.equal(
    snaggingPropertyType({ unitType: null, propertyCategory: "residential" }),
    undefined,
    "nothing says which, so an address Snagging typed keeps its type",
  );
});

test("an embedded client reads its AMC profile, and one AMC never touched is a client", () => {
  assert.deepEqual(embeddedClient({ id: "c1", name: "Sara", profile: { customer_ref: "YFI1806", lifecycle: "prospect" } }), {
    id: "c1",
    name: "Sara",
    customerRef: "YFI1806",
    lifecycle: "prospect",
  });
  assert.deepEqual(embeddedClient({ id: "c2", name: "Omar", profile: null }), {
    id: "c2",
    name: "Omar",
    customerRef: null,
    lifecycle: "client",
  });
  // Older PostgREST returns the one-to-one embed as an array.
  assert.equal(embeddedClient([{ id: "c3", name: "Ali", profile: [{ customer_ref: "X", lifecycle: "former" }] }])?.lifecycle, "former");
  assert.equal(embeddedClient(null), null);
});

test("an embedded address takes AMC's type when set, else derives it from Snagging's", () => {
  assert.deepEqual(embeddedProperty({ id: "p1", unit_label: "Clinic 3", property_type: "commercial", profile: { property_category: "commercial", unit_type: "clinic" } }), {
    id: "p1",
    label: "Clinic 3",
    propertyCategory: "commercial",
    unitType: "clinic",
  });
  assert.deepEqual(embeddedProperty({ id: "p2", unit_label: "Villa 12", property_type: "villa", profile: null }), {
    id: "p2",
    label: "Villa 12",
    propertyCategory: "residential",
    unitType: "villa",
  });
  assert.deepEqual(embeddedProperty({ id: "p3", unit_label: "Shop 1", property_type: "commercial", profile: null }), {
    id: "p3",
    label: "Shop 1",
    propertyCategory: "commercial",
    unitType: null,
  });
});

test("migration: Snagging's tables are only pointed at, never changed; old tables must be empty", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261007170000_amc_shared_clients.sql"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(sql, /ALTER TABLE public\.snagging_(clients|properties)/, "no change to Snagging's tables");
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /DROP TABLE|SECURITY DEFINER/);
  assert.match(sql, /RAISE EXCEPTION 'public\.customers has rows/);
  assert.match(sql, /REFERENCES public\.snagging_clients\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /REVOKE ALL ON public\.amc_client_profiles FROM anon, authenticated/);
  assert.match(sql, /REVOKE ALL ON public\.amc_client_directory FROM anon, authenticated/);
  assert.match(sql, /security_invoker = true/);
});
