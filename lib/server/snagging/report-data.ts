import type { SupabaseClient } from "@supabase/supabase-js";

import { signMediaPaths, signPaths } from "./media";
import { loadJobFamily } from "./job-family";

/**
 * The one description of a client report (FR-7.02 → FR-7.04).
 *
 * The PDF and the web report used to assemble themselves from separate
 * queries -- the public route had its own `assembleReport`, the portal read
 * the task endpoint -- which is exactly how two renderings of one inspection
 * come to disagree about how many snags it has. Both now read this, so the
 * totals cannot drift: there is only one place that counts.
 *
 * Everything the cover needs is computed here rather than in a renderer, for
 * the same reason.
 */

/** Sub-category level of the catalogue, and how many snags sit under it. */
export type SubCategoryTally = { label: string; code: string | null; count: number };

export type ReportCover = {
  /** The development the unit belongs to. */
  project: string | null;
  unit: string;
  /** The day the inspection was walked, not the day the report was made. */
  inspectionDate: string | null;
  developer: string | null;
  /** Building, community and city on one line, as the portal's report shows it. */
  address: string | null;
  propertyType: string | null;
  client: { name: string | null; email: string | null; phone: string | null };
  inspector: string | null;
  totalSnags: number;
  severity: { high: number; medium: number; low: number };
  /** FR-7.02 — worst first, ties broken by label so the order is stable. */
  mostAffectedSubCategories: SubCategoryTally[];
};

export type ReportSnag = {
  id: string;
  code: string | null;
  areaId: string | null;
  /** From the controlled catalogue, never the inspector's free text. */
  catalogueCode: string | null;
  subCategory: string | null;
  defect: string | null;
  description: string | null;
  severity: "low" | "medium" | "high";
  status: string;
  note: string | null;
  roundCreated: number;
  originJobId: string;
  photos: Array<{
    id: string;
    url: string | null;
    mediaType: string;
    takenAt: string | null;
    /** FR-7.03 — the marked spot, as a fraction of the image. */
    marker: { x: number; y: number } | null;
    width: number | null;
    height: number | null;
    exif: Record<string, unknown> | null;
    gps: { lat: number; lng: number } | null;
  }>;
};

export type ReportArea = {
  id: string;
  name: string;
  /** The inspection's own ordering, never alphabetical (FR-7.03). */
  sortOrder: number;
  accessState: string | null;
  accessReason: string | null;
  /** FR-7.06 — what limited access stopped the inspector reaching. */
  elementsNotChecked: string | null;
  confirmedAt: string | null;
  snags: ReportSnag[];
};

/** FR-7.06 — everything the inspection did not cover, named. */
export type CoverageGaps = {
  areas: Array<{
    id: string;
    name: string;
    accessState: string;
    reason: string | null;
    elementsNotChecked: string | null;
  }>;
  checklist: Array<{
    code: string | null;
    label: string;
    groupName: string | null;
    status: string;
    reason: string | null;
  }>;
};

export type ReportData = {
  jobId: string;
  code: string;
  status: string;
  visitType: string;
  roundNumber: number;
  generatedAt: string;
  cover: ReportCover;
  areas: ReportArea[];
  /** Snags whose area was deleted or never set; never silently dropped. */
  unassignedSnags: ReportSnag[];
  coverage: CoverageGaps;
  /**
   * The two "how much was covered" figures on the summary row.
   *
   * Counted here rather than in the template because `coverage` only carries
   * the GAPS — the items that were missed — so a renderer holding it has no
   * way to say "42 of 47" without the totals. Both use the same rule as the
   * portal's report page, so the PDF and the screen cannot disagree.
   */
  tally: {
    /** Areas the inspector confirmed walking, over every area on the job. */
    areasWalked: number;
    areasTotal: number;
    /** Checklist items with a real answer — anything but pending/not checked. */
    checklistDone: number;
    checklistTotal: number;
  };
  signOff: {
    signedAt: string | null;
    signerName: string | null;
    signatureUrl: string | null;
  };
  quotation: Record<string, unknown> | null;
};

type Admin = SupabaseClient;

/** Long enough to read a report; short enough that a shared URL goes stale. */
const PHOTO_TTL_SECONDS = 2 * 60 * 60;

/**
 * Which snags belong in this document.
 *
 * - `inspection`: the job's own snags, plus anything its additional visits
 *   added, because a visit does not get a report of its own (FR-7.08).
 * - `round`: only what the named de-snag round touched (FR-7.07).
 * - `cumulative`: the whole family — original, rounds and visits — which is
 *   the current state of the property (FR-7.07).
 */
export type ReportScope = "inspection" | "round" | "cumulative";

function severityOf(value: unknown): "low" | "medium" | "high" {
  return value === "high" || value === "medium" ? value : "low";
}

/**
 * The sub-category a snag sits under.
 *
 * The v7 catalogue is Category → Sub-category → Defect. The live catalogue
 * still carries the level as `element_label` (Paint, Floor, Doors, …), which
 * is the same level under the previous name -- so this reads that column and
 * needs no change when the rename lands. Nothing here assumes an area is
 * part of the hierarchy, which is the part of the old model that is gone.
 */
function subCategoryOf(snag: Record<string, unknown>): string | null {
  const label = snag.element_label;
  return typeof label === "string" && label.trim() ? label.trim() : null;
}

/**
 * The catalogue's own words for a defect (FR-7.03).
 *
 * Falls back to the labels stored on the snag when the catalogue row has
 * since been retired -- an issued report must still read correctly after
 * somebody tidies the catalogue.
 */
function describe(
  snag: Record<string, unknown>,
  guidance: Map<string, string>,
): string | null {
  const code = typeof snag.catalogue_code === "string" ? snag.catalogue_code : null;
  const fromCatalogue = code ? guidance.get(code) : undefined;
  if (fromCatalogue) return fromCatalogue;
  const parts = [subCategoryOf(snag), snag.defect_label].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function toReportSnag(
  snag: Record<string, unknown>,
  guidance: Map<string, string>,
): ReportSnag {
  const photos = Array.isArray(snag.photos) ? snag.photos : [];
  return {
    id: String(snag.id),
    code: typeof snag.snag_code === "string" ? snag.snag_code : null,
    areaId: typeof snag.area_id === "string" ? snag.area_id : null,
    catalogueCode: typeof snag.catalogue_code === "string" ? snag.catalogue_code : null,
    subCategory: subCategoryOf(snag),
    defect: typeof snag.defect_label === "string" ? snag.defect_label : null,
    description: describe(snag, guidance),
    severity: severityOf(snag.severity),
    status: String(snag.status ?? "open"),
    note: typeof snag.note === "string" && snag.note.trim() ? snag.note.trim() : null,
    roundCreated: Number(snag.round_created ?? 1),
    originJobId: String(snag.job_id),
    photos: (photos as Array<Record<string, unknown>>).map((photo) => {
      const x = photo.marker_x;
      const y = photo.marker_y;
      const marked =
        typeof x === "number" && typeof y === "number" &&
        x >= 0 && x <= 1 && y >= 0 && y <= 1;
      const lat = photo.gps_lat;
      const lng = photo.gps_lng;
      return {
        id: String(photo.id),
        url: typeof photo.signed_url === "string" ? photo.signed_url : null,
        mediaType: String(photo.media_type ?? "photo"),
        takenAt: typeof photo.taken_at === "string" ? photo.taken_at : null,
        marker: marked ? { x: x as number, y: y as number } : null,
        width: typeof photo.width === "number" ? photo.width : null,
        height: typeof photo.height === "number" ? photo.height : null,
        exif: (photo.exif as Record<string, unknown> | null) ?? null,
        gps:
          typeof lat === "number" && typeof lng === "number"
            ? { lat, lng }
            : null,
      };
    }),
  };
}

/**
 * Assembles everything a report needs, for one inspection, at one scope.
 *
 * Read-only: it never writes, so it is safe to call from a renderer, a
 * delivery path or a preview.
 */
export async function buildReportData(
  admin: Admin,
  jobId: string,
  scope: ReportScope = "inspection",
): Promise<ReportData | null> {
  const { data: job, error } = await admin
    .from("snagging_jobs")
    .select(
      `id, code, status, round_number, visit_type, scheduled_date, submitted_at,
       unit_label, building_name, community, property_type, developer_name,
       signed_at, signer_name, signature_path,
       client:client_id(name, email, phone),
       inspector:inspector_id(id, full_name, email),
       areas:snagging_areas(id, name, status, note, confirmed_at, sort_order,
         access_state, access_reason, elements_not_checked)`,
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!job) return null;

  const family = await loadJobFamily(admin, jobId);
  const snagJobIds =
    scope === "round"
      ? [jobId]
      : scope === "cumulative"
        ? family.allIds
        : // An inspection's report carries what its additional visits added.
          jobId === family.rootId
          ? [jobId, ...family.additionalVisitIds]
          : [jobId];

  const [{ data: checklist }, { data: snagRows }, { data: catalogue }] =
    await Promise.all([
      admin
        .from("snagging_job_checklist")
        .select("id, code, group_name, label, mandatory, status, reason, sort_order")
        .eq("job_id", jobId)
        .order("sort_order", { ascending: true }),
      admin
        .from("snagging_snags")
        .select(
          `id, job_id, area_id, snag_code, catalogue_code, element_label, defect_label,
           severity, note, status, round_created,
           photos:snagging_snag_photos(id, snag_id, storage_path, media_type, taken_at,
             width, height, gps_lat, gps_lng, exif, marker_x, marker_y)`,
        )
        .in("job_id", snagJobIds)
        .neq("status", "withdrawn")
        .order("snag_code", { ascending: true }),
      admin.from("snagging_catalogue_entries").select("code, guidance"),
    ]);

  // Signed once, in one pass: a report with two hundred snags would
  // otherwise mint a URL per photo in series.
  const signed = (await signMediaPaths(
    admin,
    snagRows ?? [],
    PHOTO_TTL_SECONDS,
  )) as Array<Record<string, unknown>>;

  const guidance = new Map<string, string>();
  for (const row of catalogue ?? []) {
    const entry = row as { code?: string; guidance?: string | null };
    if (entry.code && entry.guidance?.trim()) guidance.set(entry.code, entry.guidance.trim());
  }

  const snags = signed.map((snag) => toReportSnag(snag, guidance));

  // FR-7.03 — the inspection's configured order, never alphabetical.
  const areaRows = ((job.areas ?? []) as Array<Record<string, unknown>>)
    .slice()
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));

  const byArea = new Map<string, ReportSnag[]>();
  for (const snag of snags) {
    if (!snag.areaId) continue;
    const list = byArea.get(snag.areaId) ?? [];
    list.push(snag);
    byArea.set(snag.areaId, list);
  }

  const areas: ReportArea[] = areaRows.map((area) => ({
    id: String(area.id),
    name: String(area.name ?? "Unnamed area"),
    sortOrder: Number(area.sort_order ?? 0),
    accessState: (area.access_state as string | null) ?? null,
    accessReason: (area.access_reason as string | null) ?? null,
    elementsNotChecked: (area.elements_not_checked as string | null) ?? null,
    confirmedAt: (area.confirmed_at as string | null) ?? null,
    snags: byArea.get(String(area.id)) ?? [],
  }));

  const knownAreaIds = new Set(areas.map((area) => area.id));
  const unassignedSnags = snags.filter(
    (snag) => !snag.areaId || !knownAreaIds.has(snag.areaId),
  );

  // FR-7.02 — counted off this document's own dataset, so the cover can
  // never disagree with the body.
  const severity = { high: 0, medium: 0, low: 0 };
  const tally = new Map<string, SubCategoryTally>();
  for (const snag of snags) {
    severity[snag.severity] += 1;
    const label = snag.subCategory;
    if (!label) continue;
    const existing = tally.get(label);
    if (existing) existing.count += 1;
    else
      tally.set(label, {
        label,
        // The sub-category segment of the catalogue code, e.g. FL of FL-CRK.
        code: snag.catalogueCode?.split("-").slice(0, -1).join("-") || null,
        count: 1,
      });
  }

  const mostAffectedSubCategories = [...tally.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 5);

  const client = firstOf(job.client as ClientRow | ClientRow[] | null);
  const inspector = firstOf(job.inspector as ProfileRow | ProfileRow[] | null);

  const signatureUrl = job.signature_path
    ? (await signPaths(admin, [job.signature_path], PHOTO_TTL_SECONDS)).get(
        job.signature_path,
      ) ?? null
    : null;

  const { data: quotationRow } = await admin
    .from("snagging_quotations")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    jobId: job.id,
    code: job.code,
    status: job.status,
    visitType: job.visit_type ?? "initial",
    roundNumber: job.round_number ?? 1,
    generatedAt: new Date().toISOString(),
    cover: {
      project: job.building_name ?? job.community ?? null,
      unit: job.unit_label ?? job.code,
      inspectionDate: job.scheduled_date ?? job.submitted_at ?? null,
      developer: job.developer_name ?? null,
      /*
        The city is a constant across the app rather than a stored column —
        every job is a Dubai job — so it is written the same way here as in
        the task API and the wizard. Empty parts are dropped rather than
        leaving a stray comma on a job with no building recorded.
      */
      address:
        [job.building_name, job.community, "Dubai"].filter(Boolean).join(", ") ||
        null,
      propertyType: job.property_type ?? null,
      client: {
        name: client?.name ?? null,
        email: client?.email ?? null,
        phone: client?.phone ?? null,
      },
      inspector: inspector?.full_name ?? inspector?.email ?? null,
      totalSnags: snags.length,
      severity,
      mostAffectedSubCategories,
    },
    areas,
    unassignedSnags,
    tally: {
      areasWalked: areaRows.filter((area) => area.confirmed_at).length,
      areasTotal: areaRows.length,
      checklistDone: ((checklist ?? []) as Array<Record<string, unknown>>).filter(
        (item) => item.status !== "pending" && item.status !== "not_checked",
      ).length,
      checklistTotal: (checklist ?? []).length,
    },
    coverage: {
      // FR-7.06 — every area the inspector could not fully reach, whether or
      // not it carries a snag. An area with nothing in it is exactly the one
      // a client would otherwise read as "fine".
      areas: areaRows
        .filter(
          (area) =>
            typeof area.access_state === "string" &&
            area.access_state !== "accessible",
        )
        .map((area) => ({
          id: String(area.id),
          name: String(area.name ?? "Unnamed area"),
          accessState: String(area.access_state),
          reason: (area.access_reason as string | null) ?? null,
          elementsNotChecked: (area.elements_not_checked as string | null) ?? null,
        })),
      checklist: ((checklist ?? []) as Array<Record<string, unknown>>)
        .filter((item) => item.status === "not_checked" || item.status === "pending")
        .map((item) => ({
          code: (item.code as string | null) ?? null,
          label: String(item.label ?? ""),
          groupName: (item.group_name as string | null) ?? null,
          status: String(item.status),
          reason: (item.reason as string | null) ?? null,
        })),
    },
    signOff: {
      signedAt: job.signed_at ?? null,
      signerName: job.signer_name ?? null,
      signatureUrl,
    },
    // Only a settled quote belongs on a client-facing document.
    quotation:
      quotationRow && ["sent", "approved"].includes(quotationRow.status)
        ? quotationRow
        : null,
  };
}

type ClientRow = { name?: string; email?: string; phone?: string };
type ProfileRow = { id?: string; full_name?: string; email?: string };

function firstOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}
