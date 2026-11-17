import { test } from "node:test";
import assert from "node:assert/strict";

import { getAmcSettingsDefaults, servicesForProperty } from "@/components/dashboard/extensions/amc/amc-settings";
import { PACKAGE_TEMPLATES, suggestedPackages } from "@/lib/amc/package-templates";
import { packageSchema } from "@/lib/amc/rate-card";

const catalogue = getAmcSettingsDefaults().services;
const ids = catalogue.map((s) => s.id);

test("every template is a valid package of catalogue services", () => {
  for (const t of PACKAGE_TEMPLATES) {
    assert.equal(packageSchema.safeParse({ ...t, active: true }).success, true, `${t.id} parses`);
    for (const l of t.lines) assert.ok(ids.includes(l.serviceId), `${t.id}: ${l.serviceId} is in the catalogue`);
    assert.equal(new Set(t.lines.map((l) => l.serviceId)).size, t.lines.length, `${t.id}: no service twice`);
  }
  assert.equal(new Set(PACKAGE_TEMPLATES.map((t) => t.id)).size, PACKAGE_TEMPLATES.length, "ids are unique");
});

test("every template line is offered on every model the template is for", () => {
  for (const t of PACKAGE_TEMPLATES) {
    for (const model of t.models) {
      const offered = new Set(servicesForProperty({ services: catalogue }, model).map((s) => s.id));
      for (const l of t.lines) assert.ok(offered.has(l.serviceId), `${t.id}: ${l.serviceId} offered on ${model}`);
    }
  }
});

test("suggestions skip packages the card has and services the catalogue lacks", () => {
  const all = suggestedPackages([], ids);
  assert.equal(all.length, PACKAGE_TEMPLATES.length);
  const left = suggestedPackages([{ id: "gold", name: "Gold" }, { id: "x", name: "essential" }, { id: "premium", name: "Top" }], ids);
  assert.deepEqual(
    left.map((p) => p.id),
    ["advantage", "complete", "business", "kitchen"],
  );
  const few = suggestedPackages([], ["helpdesk", "emergency", "ac-ppm"]);
  assert.ok(few.every((p) => p.lines.every((l) => ["helpdesk", "emergency", "ac-ppm"].includes(l.serviceId))));
});
