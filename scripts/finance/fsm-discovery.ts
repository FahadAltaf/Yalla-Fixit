/*
  FSM discovery spike (Finance & Reports, phase 0).

  Answers one question before any data model is built: which of the FSM
  resources the BRD depends on actually exist in this org's API, and under
  which field names. Read-only by construction -- every call goes through
  createFsmReader, which can only send a GET and refuses /actions/ paths.

  What it records: module names, field api names, labels, data types and
  picklist values, and the KEYS (with value types) of one sample record per
  module. It never records a record's values: a work order sample carries a
  client's name and phone number, and none of that belongs in a file.

  Run (FINANCE_FSM_READ must be set on the command line; .env keeps it off):
    FINANCE_FSM_READ=on DISCOVERY_OUT=<path.json> \
      node --env-file=.env --import ./tests/setup/register.mjs \
      scripts/finance/fsm-discovery.ts
*/
import { writeFileSync } from "node:fs";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getFsmAccessToken, FSM_BASE_URL } from "@/lib/server/zoho/fsm-client";
import { assertReadOnlyRequest, createFsmReader, financeFsmReadEnabled } from "@/lib/server/finance/fsm-read";

/* What the BRD needs, as patterns over a field's api name or label. */
const INTEREST: Record<string, RegExp> = {
  invoice_flag: /invoic|billing/i,
  actual_times: /actual/i,
  check_in_out: /check.?in|check.?out|clock/i,
  completion: /complet/i,
  rating: /rating|feedback|survey|satisf/i,
  travel: /trip|travel|mileage|distance/i,
  line_items: /line.?item/i,
  status: /^status$|_status$|status__c/i,
};

/* Modules worth a field listing whatever their names turn out to be. */
const CORE_MODULES = ["Work_Orders", "Service_Appointments", "Estimates"];
const EXTRA_MODULE_HINT = /trip|time.?sheet|check|attend|rating|feedback|survey|shift|availab|service_report|report/i;

type Field = {
  api_name?: string;
  field_label?: string;
  display_label?: string;
  data_type?: string;
  custom_field?: boolean;
  pick_list_values?: { display_value?: string; actual_value?: string }[];
};

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" ? `array<object:${Object.keys(first).length} keys>` : `array<${typeof first}>`;
  }
  return typeof value;
}

/* The shape of a record, never its contents. */
function shapeOf(record: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) out[key] = typeOf(value);
  return out;
}

function matches(field: Field): string[] {
  const text = `${field.api_name ?? ""} ${field.field_label ?? field.display_label ?? ""}`;
  return Object.entries(INTEREST)
    .filter(([, re]) => re.test(text))
    .map(([tag]) => tag);
}

async function main() {
  if (!financeFsmReadEnabled()) {
    throw new Error("Set FINANCE_FSM_READ=on on the command line for this run.");
  }
  const outPath = process.env.DISCOVERY_OUT;
  if (!outPath) throw new Error("Set DISCOVERY_OUT to a path outside the repo.");

  const admin = await createAdminServerClient();
  const token = await getFsmAccessToken(admin);
  const reader = createFsmReader({ token, budget: 60 });
  const report: Record<string, unknown> = { ran_at: new Date().toISOString(), base: FSM_BASE_URL };

  /* 1. Rate-limit headers. fsmFetch does not expose headers, so one raw
        request is made here -- through the same read-only guard. */
  {
    const init: RequestInit = { method: "GET" };
    const path = "/settings/modules";
    assertReadOnlyRequest(path, init);
    const res = await fetch(`${FSM_BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (/ratelimit|retry|x-/i.test(k)) headers[k] = v;
    });
    report.rate_limit_headers = { status: res.status, headers };
  }

  /* 2. Every module the org exposes. */
  const modulesRes = await reader.get("/settings/modules");
  const modules = (modulesRes.json?.modules ?? modulesRes.json?.data ?? []) as Record<string, unknown>[];
  report.modules = {
    status: modulesRes.status,
    count: modules.length,
    list: modules.map((m) => ({
      api_name: m.api_name,
      label: m.plural_label ?? m.module_name ?? m.singular_label,
      api_supported: m.api_supported,
    })),
  };

  const extra = modules
    .map((m) => String(m.api_name ?? ""))
    .filter((n) => n && EXTRA_MODULE_HINT.test(n) && !CORE_MODULES.includes(n));
  const toInspect = [...CORE_MODULES, ...extra];

  /* 3. Field metadata, and the fields the BRD cares about. */
  const fields: Record<string, unknown> = {};
  for (const moduleName of toInspect) {
    const res = await reader.get(`/settings/fields?module=${encodeURIComponent(moduleName)}`);
    const list = (res.json?.fields ?? []) as Field[];
    fields[moduleName] = {
      status: res.status,
      count: list.length,
      of_interest: list
        .map((f) => ({ f, tags: matches(f) }))
        .filter(({ tags }) => tags.length > 0)
        .map(({ f, tags }) => ({
          api_name: f.api_name,
          label: f.field_label ?? f.display_label,
          data_type: f.data_type,
          custom: f.custom_field ?? null,
          tags,
          picklist: f.pick_list_values?.map((p) => p.actual_value ?? p.display_value),
        })),
      all_api_names: list.map((f) => f.api_name),
      error: res.ok ? undefined : res.json,
    };
  }
  report.fields = fields;

  /* 4. One record per core module: keys and value types only. */
  const samples: Record<string, unknown> = {};
  for (const moduleName of CORE_MODULES) {
    const res = await reader.get(`/${moduleName}?per_page=1&page=1`);
    const first = (res.json?.data ?? [])[0] as Record<string, unknown> | undefined;
    const sample: Record<string, unknown> = { status: res.status, shape: first ? shapeOf(first) : null };
    if (first) {
      for (const sub of ["Service_Line_Items", "Part_Line_Items", "Service_Tasks_Line_Items", "Appointments_X_Services"]) {
        const rows = first[sub];
        if (Array.isArray(rows) && rows[0] && typeof rows[0] === "object") {
          sample[`${sub}_row_shape`] = shapeOf(rows[0] as Record<string, unknown>);
        }
      }
    }
    samples[moduleName] = sample;
  }
  report.samples = samples;

  report.calls_used = reader.calls() + 1;
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`wrote ${outPath} (${reader.calls() + 1} FSM calls, all GET)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
