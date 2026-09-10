/**
 * Seeds the snag catalogue from Behrouz's defect library (Action Points P5).
 *
 *   node scripts/seed-snag-catalogue.mjs <library.xlsx>            # dry run
 *   node scripts/seed-snag-catalogue.mjs <library.xlsx> --apply    # writes
 *   node scripts/seed-snag-catalogue.mjs <library.xlsx> --apply --fold
 *
 * The catalogue is REPLACED, not migrated (P5), so `--apply` clears the
 * three tables first. It refuses to run over an already-seeded catalogue
 * without `--force`: every id is regenerated, so a second run would break
 * anything already recorded against the current rows.
 *
 * Codes are derived per level, so the composed snag code comes out in the
 * shape P3 asks for — CIV-PNT-DRP — whatever the source spreadsheet uses
 * for its own identifiers. `--fold` additionally maps the library's main
 * categories onto the six YFI categories from P1; without it the library's
 * own categories are seeded as they stand. See CATEGORY_FOLD below.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

/**
 * The six YFI categories (P1), and which library categories fold into each.
 *
 * Only used with `--fold`. The library Behrouz supplied has twenty main
 * categories rather than six, and the two cannot both be right — this is
 * the mapping to review if the six are confirmed as the ones YFI wants.
 */
const CATEGORY_FOLD = {
  CIV: {
    label: "Civil",
    matches: [
      "Civil & Structural",
      "Walls, Ceilings & Finishes",
      "Flooring & Tiling",
      "Doors, Windows & Glazing",
      "Joinery, Cabinetry & Furniture",
      "Kitchen",
      "Bathrooms & Sanitary Fixtures",
      "General & Documentation",
      "Housekeeping & Handover Condition",
    ],
  },
  ELE: {
    label: "Electrical",
    matches: [
      "Electrical, Lighting & Power",
      "ELV, Security & Smart Home",
      "Appliances & Installed Equipment",
    ],
  },
  PLM: {
    label: "Plumbing",
    matches: ["Plumbing, Drainage & Water Systems", "Utilities & Plant Rooms"],
  },
  ACV: { label: "A/C", matches: ["Air Conditioning & Ventilation"] },
  EHS: { label: "EHS", matches: ["Fire, Life Safety & EHS"] },
  OUT: {
    label: "Outdoor",
    matches: [
      "Facade, Balcony, Roof & External Areas",
      "Landscape & Irrigation",
      "Swimming Pool & Water Features",
      "Garage, Driveway & Gates",
    ],
  },
};

/** Stop words that carry no meaning in a three-letter code. */
const NOISE = new Set(["and", "the", "of", "for", "in", "on", "a", "an", "&"]);

/**
 * A short code for a label: initials where the label has several words,
 * otherwise its first letters. Uppercase, letters and digits only.
 */
function deriveCode(label, length = 3) {
  const words = String(label)
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !NOISE.has(w.toLowerCase()));

  const code =
    words.length >= length
      ? words.slice(0, length).map((w) => w[0]).join("")
      : words.join("").slice(0, length);

  return (code || "XXX").toUpperCase().padEnd(length, "X").slice(0, length);
}

/** Makes a derived code unique within its parent by bumping the last char. */
function unique(code, taken) {
  if (!taken.has(code)) {
    taken.add(code);
    return code;
  }
  for (let i = 2; i < 100; i++) {
    const next = `${code.slice(0, 2)}${i}`.toUpperCase().slice(0, 4);
    if (!taken.has(next)) {
      taken.add(next);
      return next;
    }
  }
  throw new Error(`Cannot make ${code} unique`);
}

function env() {
  const text = [".env", ".env.local"]
    .map((f) => {
      try {
        return fs.readFileSync(path.join(process.cwd(), f), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [
        l.slice(0, l.indexOf("=")).trim(),
        l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""),
      ]),
  );
}

/**
 * The library's tree, exactly as it ships.
 *
 * Labels are taken verbatim — "Civil & Structural" stays "Civil &
 * Structural", not shortened to "Civil" — because the library is the
 * controlled vocabulary and renaming its categories here would mean the
 * platform and the source disagree about what a category is called.
 *
 * Codes come from the library's own numbering rather than from initials of
 * the label. `SN-01-01-01` gives category 01, sub-category 01, defect 01,
 * so the composed code is derived from the source rather than invented,
 * and stays stable when a label is reworded. The full library code rides
 * along in `source_code`, which is what a re-import matches on.
 */
function buildTree(rows, fold) {
  const categories = new Map();

  for (const row of rows) {
    const mainLabel = String(row["Main Category"] ?? "").trim();
    const subLabel = String(row["Subcategory"] ?? "").trim();
    const defectLabel = String(row["Defect"] ?? "").trim();
    const sourceCode = String(row["Defect Code"] ?? "").trim();
    if (!mainLabel || !subLabel || !defectLabel) continue;

    // SN-01-02-03 -> ['SN', '01', '02', '03']
    const segments = sourceCode.split("-");
    const hasSegments = segments.length === 4;

    let catCode;
    let catLabel;
    if (fold) {
      const entry = Object.entries(CATEGORY_FOLD).find(([, v]) =>
        v.matches.includes(mainLabel),
      );
      if (!entry) throw new Error(`No fold mapping for category "${mainLabel}"`);
      [catCode] = entry;
      catLabel = entry[1].label;
    } else {
      catLabel = mainLabel;
      catCode = hasSegments ? `${segments[0]}${segments[1]}` : null;
    }

    const key = fold ? catCode : mainLabel;
    if (!categories.has(key)) {
      categories.set(key, {
        label: catLabel,
        code: catCode,
        subs: new Map(),
        _subCodes: new Set(),
      });
    }
    const category = categories.get(key);

    if (!category.subs.has(subLabel)) {
      category.subs.set(subLabel, {
        label: subLabel,
        code:
          !fold && hasSegments
            ? segments[2]
            : unique(deriveCode(subLabel), category._subCodes),
        defects: [],
        _defectCodes: new Set(),
      });
    }
    const sub = category.subs.get(subLabel);

    sub.defects.push({
      label: defectLabel,
      code:
        !fold && hasSegments
          ? segments[3]
          : unique(deriveCode(defectLabel), sub._defectCodes),
      // The library carries no severity; medium is the neutral default and
      // an admin can raise the ones that matter without a release.
      default_severity: "medium",
      source_code: sourceCode || null,
    });
  }

  // Folding invents categories, so those need codes derived from labels.
  if (fold) return categories;

  for (const category of categories.values()) {
    if (!category.code) {
      throw new Error(
        `"${category.label}" has no library code to derive from — every row ` +
          "needs a Defect Code in the SN-NN-NN-NN shape.",
      );
    }
  }
  return categories;
}

async function main() {
  const [, , file, ...flags] = process.argv;
  if (!file) throw new Error("Usage: seed-snag-catalogue.mjs <library.xlsx> [--apply] [--fold]");
  const apply = flags.includes("--apply");
  const fold = flags.includes("--fold");

  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets["Defect Library"] ?? wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const tree = buildTree(rows, fold);

  let subCount = 0;
  let defectCount = 0;
  for (const c of tree.values()) {
    subCount += c.subs.size;
    for (const s of c.subs.values()) defectCount += s.defects.length;
  }

  console.log(
    `${tree.size} categories · ${subCount} sub-categories · ${defectCount} defects` +
      (fold ? "  (folded to the six YFI categories)" : "  (library categories as supplied)"),
  );
  for (const c of tree.values()) {
    const first = [...c.subs.values()][0];
    const sample = first?.defects[0];
    console.log(
      `  ${c.code.padEnd(4)} ${c.label.padEnd(42)} ${String(c.subs.size).padStart(3)} sub` +
        (sample ? `   e.g. ${c.code}-${first.code}-${sample.code}` : ""),
    );
  }

  if (!apply) {
    console.log("\nDRY RUN — pass --apply to write. Add --fold for the six YFI categories.");
    return;
  }

  const e = env();
  const H = {
    apikey: e.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  const API = `${e.SUPABASE_URL}/rest/v1`;

  /*
    Refuse to rebuild a catalogue that already has one.

    An earlier version of this checked snagging_snags.catalogue_entry_id
    instead, and was wrong: that column points at the OLD
    snagging_catalogue_entries table, which this script never touches. It
    refused on 64 test snags that were in no danger at all.

    The real risk is re-running after capture has started pointing snags at
    these rows — every id is regenerated, so a second run would silently
    break every classification recorded against the first. Nothing links to
    them yet, so an empty table is the safe case; anything else needs
    --force and someone who knows what they are doing.
  */
  const existing = await fetch(
    `${API}/snagging_catalogue_defects?select=id&limit=1`,
    { headers: { ...H, Prefer: "count=exact", Range: "0-0" } },
  );
  const seeded = Number(
    (existing.headers.get("content-range") ?? "*/0").split("/")[1] || 0,
  );
  if (seeded > 0 && !flags.includes("--force")) {
    throw new Error(
      `The catalogue already holds ${seeded} defects. Re-seeding regenerates ` +
        "every id, which breaks any snag recorded against the current rows. " +
        "Pass --force if that is genuinely what you want.",
    );
  }

  for (const table of [
    "snagging_catalogue_defects",
    "snagging_catalogue_subcategories",
    "snagging_catalogue_categories",
  ]) {
    const res = await fetch(`${API}/${table}?id=not.is.null`, {
      method: "DELETE",
      headers: H,
    });
    if (!res.ok) throw new Error(`Clearing ${table}: ${res.status} ${await res.text()}`);
  }

  let catSort = 0;
  for (const category of tree.values()) {
    catSort += 10;
    const [saved] = await fetch(`${API}/snagging_catalogue_categories`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        code: category.code,
        label: category.label,
        sort_order: catSort,
      }),
    }).then((r) => r.json());

    let subSort = 0;
    for (const sub of category.subs.values()) {
      subSort += 10;
      const [savedSub] = await fetch(`${API}/snagging_catalogue_subcategories`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          category_id: saved.id,
          code: sub.code,
          label: sub.label,
          sort_order: subSort,
        }),
      }).then((r) => r.json());

      // One request per sub-category rather than per defect: the library
      // runs to a thousand rows and a round trip each would take minutes.
      const payload = sub.defects.map((d, index) => ({
        subcategory_id: savedSub.id,
        code: d.code,
        label: d.label,
        default_severity: d.default_severity,
        source_code: d.source_code,
        sort_order: (index + 1) * 10,
      }));
      const res = await fetch(`${API}/snagging_catalogue_defects`, {
        method: "POST",
        headers: { ...H, Prefer: "return=minimal" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`Seeding ${category.code}-${sub.code}: ${await res.text()}`);
      }
    }
    console.log(`  seeded ${category.code} ${category.label}`);
  }

  console.log(`\nSeeded ${tree.size} categories, ${subCount} sub-categories, ${defectCount} defects.`);
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exitCode = 1;
});
