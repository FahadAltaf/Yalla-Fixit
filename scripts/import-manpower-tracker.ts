// One-time import of the YFI Manpower Tracker workbook (FRD FR-12, section 9).
//
//   bun scripts/import-manpower-tracker.ts "<path>\YFI Manpower Tracker.xlsx" [--apply] [--real-identity] [--as-of YYYY-MM-DD] [--force]
//
// Dry run by default: parses the "Manpower Master" tab, applies the cleanup
// rules, and writes a report. --apply loads the rows (brought forward from
// phase 3 on 27 Oct 2026 so the module can be tested with real records).
//
// Identity numbers are REDACTED unless --real-identity is given: the
// Emirates ID and passport are replaced by synthetic numbers of the same
// shape, because the role-permissions route is still open (S0) and the
// module is being tested before release. Expiry dates stay real, which is
// what the status engine needs.
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env / .env.local in
// the Portal folder, like scripts/seed-snag-catalogue.mjs. Sites are left
// Unassigned (the workbook-to-FSM-client map is a phase 3 decision, D4).
// Rollback: delete from compliance_employees where import_batch_id = '<id>'.

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { identityStatus, certificateStatus, type ComplianceItemStatus } from "@/lib/compliance/status";
import { isRealDate } from "@/lib/compliance/validation";
import { maskForAudit, normaliseEmiratesId } from "@/lib/compliance/masking";
import { isActiveManpower, type ComplianceEmploymentStatus } from "@/lib/compliance/statuses";
import { todayInZone } from "@/lib/scheduling/org-time";

// ---------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const realIdentity = args.includes("--real-identity");
const force = args.includes("--force");
const asOfArg = args[args.indexOf("--as-of") + 1];
const asOf = args.includes("--as-of") && asOfArg && isRealDate(asOfArg) ? asOfArg : todayInZone();
if (!file) {
  console.error('Usage: bun scripts/import-manpower-tracker.ts "<workbook.xlsx>" [--apply] [--real-identity] [--as-of YYYY-MM-DD] [--force]');
  process.exit(2);
}

// ---------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------
const SHEET = "Manpower Master";
const CERTIFICATE_COLUMNS: { name: string; held: string; expiry: string }[] = [
  { name: "Confined Space", held: "Confined Space Trained", expiry: "Confined Space Expiry" },
  { name: "Scissor Lift", held: "Scissor Lift Trained", expiry: "Scissor Lift Expiry" },
  { name: "Health & Safety", held: "Health & Safety Trained", expiry: "H&S Expiry" },
  { name: "First Aid", held: "First Aid Trained", expiry: "First Aid Expiry" },
  { name: "Scaffolding", held: "Scaffolding", expiry: "Scaffolding Expiry" },
  { name: "DCCS", held: "DCCS Certified", expiry: "DCCS Expiry" },
];
const REQUIRED_TYPES = ["Confined Space", "Scissor Lift", "Health & Safety", "First Aid", "Working at Height", "Scaffolding", "DCCS"];

const NATIONALITY_MAP: Record<string, string> = {
  nepali: "Nepal", indian: "India", filipino: "Philippines", ghanaian: "Ghana", umurundi: "Burundi",
};
const DESIGNATION_MAP: Record<string, string> = { "ac technician": "AC Technician" };
const STATUS_MAP: Record<string, ComplianceEmploymentStatus> = {
  active: "active", "on leave": "on_leave", inactive: "inactive", resigned: "resigned", terminated: "terminated",
};

type Raw = Record<string, unknown>;

type Cleaned = {
  row: number;
  maher_id: string;
  full_name: string;
  designation: string | null;
  nationality: string | null;
  date_of_joining: string | null;
  employment_status: ComplianceEmploymentStatus;
  remarks: string | null;
  emirates_id_number: string | null;
  emirates_id_expiry: string | null;
  passport_number: string | null;
  passport_expiry: string | null;
  certificates: { name: string; held: boolean; expiry_date: string | null }[];
  flags: string[];
  held_back: string | null;
};

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

function excelDate(v: unknown, flags: string[], label: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  let iso: string | null = null;
  if (typeof v === "number") {
    if (v <= 0) {
      flags.push(`${label}: serial ${v} is not a date, left blank`);
      return null;
    }
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    iso = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  } else if (v instanceof Date) {
    iso = v.toISOString().slice(0, 10);
  } else {
    const s = text(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) {
      flags.push(`${label}: "${s}" is not a date, left blank`);
      return null;
    }
    iso = m[0].includes("/") ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : m[0];
  }
  if (!isRealDate(iso)) {
    flags.push(`${label}: ${iso} is outside 1950..2100 or impossible, left blank`);
    return null;
  }
  return iso;
}

function syntheticEid(seed: string): string {
  const h = createHash("sha256").update(`eid:${seed}`).digest("hex");
  return "784" + BigInt("0x" + h.slice(0, 16)).toString().padStart(12, "0").slice(-12);
}
function syntheticPassport(seed: string): string {
  const h = createHash("sha256").update(`pp:${seed}`).digest("hex");
  return "T" + BigInt("0x" + h.slice(0, 12)).toString().padStart(7, "0").slice(-7);
}

function clean(raw: Raw, row: number, today: string): Cleaned | null {
  if (!Object.values(raw).some((v) => text(v) !== "")) return null;
  const flags: string[] = [];
  const maher_id = text(raw["Employee ID"]);
  const full_name = text(raw["Employee Name"]).replace(/\s+/g, " ");
  let held_back: string | null = null;
  if (!maher_id) held_back = "no Employee ID";
  else if (!full_name) held_back = "no name";

  const desigRaw = text(raw["Designation"]);
  const designation = desigRaw ? (DESIGNATION_MAP[desigRaw.toLowerCase()] ?? desigRaw) : null;
  if (!designation) flags.push("designation blank");
  const natRaw = text(raw["Nationality"]);
  const nationality = natRaw ? (NATIONALITY_MAP[natRaw.toLowerCase()] ?? natRaw) : null;
  if (natRaw && nationality !== natRaw) flags.push(`nationality "${natRaw}" normalised to ${nationality}`);

  let date_of_joining = excelDate(raw["Date of Joining"], flags, "Date of joining");
  if (date_of_joining && date_of_joining > today) {
    flags.push(`Date of joining ${date_of_joining} is in the future, left blank`);
    date_of_joining = null;
  }
  if (!date_of_joining && !flags.some((f) => f.startsWith("Date of joining"))) flags.push("Date of joining blank");

  const statusRaw = text(raw["Employment Status"]).toLowerCase();
  let employment_status: ComplianceEmploymentStatus = "inactive";
  if (!statusRaw) flags.push("employment status blank, imported as Inactive");
  else if (STATUS_MAP[statusRaw]) employment_status = STATUS_MAP[statusRaw];
  else flags.push(`employment status "${statusRaw}" unknown, imported as Inactive`);

  let emirates_id_number: string | null = normaliseEmiratesId(text(raw["EID NO"])) || null;
  if (emirates_id_number && !/^\d{15}$/.test(emirates_id_number)) {
    flags.push(`Emirates ID "${maskForAudit(emirates_id_number)}" is not 15 digits, left blank`);
    emirates_id_number = null;
  } else if (emirates_id_number && !emirates_id_number.startsWith("784")) {
    flags.push("Emirates ID does not start with 784; kept as typed, check with HR");
  }
  const emirates_id_expiry = excelDate(raw["Emirates ID Expiry Date"], flags, "Emirates ID expiry");
  let passport_number: string | null = text(raw["Passport Number"]) || null;
  if (passport_number && !/^[A-Za-z0-9]{5,20}$/.test(passport_number)) {
    flags.push(`passport "${maskForAudit(passport_number)}" is not 5-20 letters/digits, left blank`);
    passport_number = null;
  }
  const passport_expiry = excelDate(raw["Passport Expiry Date"], flags, "Passport expiry");

  if (!realIdentity) {
    if (emirates_id_number) emirates_id_number = syntheticEid(maher_id);
    if (passport_number) passport_number = syntheticPassport(maher_id);
  }

  const certificates = CERTIFICATE_COLUMNS.map((c) => {
    const heldRaw = text(raw[c.held]).toLowerCase();
    const held = heldRaw === "yes";
    const expiry_date = held ? excelDate(raw[c.expiry], flags, `${c.name} expiry`) : null;
    if (held && !expiry_date) flags.push(`${c.name}: held with no expiry (Missing expiry)`);
    if (!held && text(raw[c.expiry])) flags.push(`${c.name}: date present but not held, date dropped`);
    return { name: c.name, held, expiry_date };
  });

  return {
    row, maher_id, full_name, designation, nationality, date_of_joining, employment_status,
    remarks: text(raw["Remarks"]) || null,
    emirates_id_number, emirates_id_expiry, passport_number, passport_expiry, certificates, flags, held_back,
  };
}

// ---------------------------------------------------------------------
// Env and client
// ---------------------------------------------------------------------
function env(): Record<string, string> {
  const joined = [".env", ".env.local"]
    .map((f) => {
      try {
        return fs.readFileSync(path.join(process.cwd(), f), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
  return Object.fromEntries(
    joined
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
  );
}

async function main() {
  const wb = XLSX.readFile(file as string, { cellDates: false });
  const sheet = wb.Sheets[SHEET];
  if (!sheet) throw new Error(`Tab "${SHEET}" not found in ${file}`);
  const rawRows = XLSX.utils.sheet_to_json<Raw>(sheet, { defval: "", raw: true });
  const cleaned = rawRows.map((r, i) => clean(r, i + 2, asOf)).filter((r): r is Cleaned => r !== null);

  // Duplicate Maher IDs inside the sheet: both rows held back (FRD section 9).
  const counts = new Map<string, number>();
  cleaned.forEach((c) => counts.set(c.maher_id, (counts.get(c.maher_id) ?? 0) + 1));
  cleaned.forEach((c) => {
    if (c.maher_id && (counts.get(c.maher_id) ?? 0) > 1) c.held_back = c.held_back ?? "duplicate Employee ID in the sheet; both rows held back";
  });

  const e = env();
  if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env/.env.local");
  const admin = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const host = new URL(e.SUPABASE_URL).host;

  // Preflight: certificate types.
  const { data: typeRows, error: typeError } = await admin.from("compliance_certificate_types").select("id, name, expires, is_active");
  if (typeError) throw new Error(`Cannot read certificate types (is the core migration applied?): ${typeError.message}`);
  const typeByName = new Map((typeRows ?? []).map((t: { id: string; name: string; expires: boolean; is_active: boolean }) => [t.name.trim().toLowerCase(), t]));
  const missingTypes = REQUIRED_TYPES.filter((n) => !typeByName.has(n.toLowerCase()));

  // Existing employees (skip those already present).
  const { data: existing, error: existingError } = await admin.from("compliance_employees").select("maher_id, import_batch_id");
  if (existingError) throw new Error(existingError.message);
  const existingIds = new Set((existing ?? []).map((r: { maher_id: string }) => r.maher_id));
  const appliedBatches = new Set((existing ?? []).map((r: { import_batch_id: string | null }) => r.import_batch_id).filter(Boolean));
  cleaned.forEach((c) => {
    if (!c.held_back && existingIds.has(c.maher_id)) c.held_back = "already exists in the portal";
  });

  const importable = cleaned.filter((c) => !c.held_back);

  // Reconciliation against the FRD targets.
  const tally = (): Record<ComplianceItemStatus, number> => ({ valid: 0, due_90: 0, due_60: 0, due_30: 0, expired: 0, missing_expiry: 0, not_held: 0 });
  const eid = tally();
  const pp = tally();
  const certHeld: Record<string, number> = {};
  let active = 0;
  for (const c of importable) {
    if (!isActiveManpower(c.employment_status)) continue;
    active += 1;
    eid[identityStatus(c.emirates_id_expiry, asOf).status] += 1;
    pp[identityStatus(c.passport_expiry, asOf).status] += 1;
    for (const cert of c.certificates) {
      if (!cert.held) continue;
      certHeld[cert.name] = (certHeld[cert.name] ?? 0) + 1;
      certificateStatus({ held: true, expiry: cert.expiry_date, expires: true }, asOf);
    }
  }

  const lines: string[] = [];
  lines.push(`Manpower Tracker import ${apply ? "APPLY" : "DRY RUN"}  ·  ${new Date().toISOString()}`);
  lines.push(`Workbook: ${file}`);
  lines.push(`Target: ${host}  ·  as-of ${asOf}  ·  identity numbers ${realIdentity ? "REAL" : "REDACTED (synthetic)"}`);
  lines.push("");
  lines.push(`Rows read: ${rawRows.length}; non-empty: ${cleaned.length}; importable: ${importable.length}; held back: ${cleaned.length - importable.length}`);
  lines.push(`Active manpower (Active + On Leave): ${active}`);
  lines.push(`Emirates ID (active): valid ${eid.valid}, due90 ${eid.due_90}, due60 ${eid.due_60}, due30 ${eid.due_30}, expired ${eid.expired}, missing ${eid.missing_expiry}`);
  lines.push(`Passport (active): valid ${pp.valid}, due90 ${pp.due_90}, due60 ${pp.due_60}, due30 ${pp.due_30}, expired ${pp.expired}, missing ${pp.missing_expiry}`);
  lines.push(`Certificates held (active): ${Object.entries(certHeld).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  lines.push("Sites: all Unassigned in this load (workbook-to-FSM-client map is a phase 3 decision).");
  lines.push("");
  lines.push(`Certificate types in the portal (${(typeRows ?? []).length}): ${(typeRows ?? []).map((t: { name: string; is_active: boolean }) => `"${t.name}"${t.is_active ? "" : " (retired)"}`).join("  ") || "none"}`);
  lines.push(`Required names missing: ${missingTypes.length ? missingTypes.join(", ") + " (rename the portal entries to match exactly, or they cannot be mapped)" : "none"}`);
  lines.push("");
  lines.push("HELD BACK");
  cleaned.filter((c) => c.held_back).forEach((c) => lines.push(`  row ${c.row}  ${c.maher_id || "(no id)"}  ${c.full_name || "(no name)"}: ${c.held_back}`));
  lines.push("");
  lines.push("ADJUSTED ROWS (imported with these notes)");
  importable.filter((c) => c.flags.length).forEach((c) => lines.push(`  row ${c.row}  ${c.maher_id}  ${c.full_name}: ${c.flags.join("; ")}`));
  lines.push("");

  const reportDir = path.resolve(process.cwd(), "..", "Documents");
  const reportPath = path.join(fs.existsSync(reportDir) ? reportDir : process.cwd(), `manpower-import-report-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`);

  if (!apply) {
    lines.push("DRY RUN: nothing written. Pass --apply to load the importable rows.");
    fs.writeFileSync(reportPath, lines.join("\n"));
    console.log(lines.slice(0, 12).join("\n"));
    console.log(`\nFull report: ${reportPath}`);
    return;
  }

  if (missingTypes.length) throw new Error(`Refusing to apply: certificate types missing: ${missingTypes.join(", ")}. Enter them under Settings → Compliance first.`);
  if (appliedBatches.size && !force) throw new Error(`Refusing to apply: an import batch already exists (${[...appliedBatches].join(", ")}). Pass --force to add another.`);

  const batchId = randomUUID();
  const sha = createHash("sha256").update(fs.readFileSync(file as string)).digest("hex");
  lines.push(`BATCH ${batchId}  (workbook sha256 ${sha})`);

  // Lists: find-or-create designations and nationalities.
  async function ensure(listKey: string, name: string, cache: Map<string, string>): Promise<string> {
    const key = name.toLowerCase();
    const hit = cache.get(key);
    if (hit) return hit;
    const { data: found } = await admin.from("lookup_options").select("id, name").eq("list_key", listKey).ilike("name", name).limit(1);
    if (found && found[0]) {
      cache.set(key, found[0].id);
      return found[0].id;
    }
    const { data: created, error } = await admin.from("lookup_options").insert({ list_key: listKey, name }).select("id").single();
    if (error) throw new Error(`Could not create ${listKey} "${name}": ${error.message}`);
    lines.push(`  created ${listKey}: ${name}`);
    cache.set(key, created.id);
    return created.id;
  }
  const desigCache = new Map<string, string>();
  const natCache = new Map<string, string>();

  let inserted = 0;
  for (const c of importable) {
    const designation_id = c.designation ? await ensure("compliance_designation", c.designation, desigCache) : null;
    const nationality_id = c.nationality ? await ensure("compliance_nationality", c.nationality, natCache) : null;
    const { data: emp, error: empError } = await admin
      .from("compliance_employees")
      .insert({
        maher_id: c.maher_id, full_name: c.full_name, designation_id, nationality_id, date_of_joining: c.date_of_joining,
        employment_status: c.employment_status, remarks: c.remarks, import_batch_id: batchId, import_row: c.row,
      })
      .select("id")
      .single();
    if (empError) {
      lines.push(`  FAILED row ${c.row} ${c.maher_id}: ${empError.message}`);
      continue;
    }
    const id = emp.id as string;
    const { error: idError } = await admin.from("compliance_identity_documents").insert({
      employee_id: id, emirates_id_number: c.emirates_id_number, emirates_id_expiry: c.emirates_id_expiry,
      passport_number: c.passport_number, passport_expiry: c.passport_expiry,
    });
    if (idError) {
      lines.push(`  FAILED identity row ${c.row} ${c.maher_id}: ${idError.message}; employee row removed`);
      await admin.from("compliance_employees").delete().eq("id", id);
      continue;
    }
    const certRows = c.certificates
      .filter((cert) => cert.held)
      .map((cert) => ({ employee_id: id, certificate_type_id: typeByName.get(cert.name.toLowerCase())!.id, held: true, expiry_date: cert.expiry_date }));
    if (certRows.length) {
      const { error: certError } = await admin.from("compliance_employee_certificates").insert(certRows);
      if (certError) {
        lines.push(`  FAILED certificates row ${c.row} ${c.maher_id}: ${certError.message}; employee row removed`);
        await admin.from("compliance_employees").delete().eq("id", id);
        continue;
      }
    }
    await admin.from("compliance_audit_events").insert({
      entity_type: "employee", entity_id: id, employee_id: id, event_type: "import", origin: "import", import_batch_id: batchId,
      actor_label: "import script",
      new_value: { maher_id: c.maher_id, full_name: c.full_name, employment_status: c.employment_status, row: c.row, flags: c.flags, identity_redacted: !realIdentity },
    });
    inserted += 1;
  }
  await admin.from("compliance_audit_events").insert({
    entity_type: "import", entity_id: batchId, event_type: "import", origin: "import", import_batch_id: batchId, actor_label: "import script",
    new_value: { workbook_sha256: sha, rows_read: rawRows.length, inserted, held_back: cleaned.length - importable.length, as_of: asOf, identity_redacted: !realIdentity },
  });
  lines.push(`Inserted ${inserted} employees. Rollback: delete from compliance_employees where import_batch_id = '${batchId}';`);
  fs.writeFileSync(reportPath, lines.join("\n"));
  console.log(lines.slice(0, 12).join("\n"));
  console.log(`\nInserted ${inserted}. Batch ${batchId}. Full report: ${reportPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
