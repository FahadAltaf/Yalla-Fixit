import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { APPROVAL_SLA_HOURS, generateTaskCode } from "@/lib/server/snagging/workflow";
import { propertySnapshot, resolveProperty } from "@/lib/server/snagging/property";
import { createTaskSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType, type SnaggingVisitType } from "@/types/types";

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

/**
 * Inspection jobs (FR-1.01 to FR-1.06).
 *
 * The lean schema merged property + floor plan + submission + the single
 * inspector into `snagging_jobs`, and clients into `snagging_clients`.
 * These handlers map that onto the same JSON shapes the dashboard and the
 * mobile app already read, so nothing downstream had to change.
 */
export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = req.nextUrl.searchParams;
    const page = Math.max(0, Number(params.get("page") ?? 0));
    const pageSize = Math.min(200, Math.max(1, Number(params.get("pageSize") ?? 25)));

    const admin = await createAdminServerClient();
    let query = admin
      .from("snagging_jobs")
      .select(
        `id, code, status, round_number, visit_type, parent_job_id, scheduled_date, locked,
         rejection_reason, rejection_category, rejection_count, remediation_due_at,
         submitted_at, approved_at, created_at, updated_at,
         approval_manager_id, reviewer_id, review_started_at, reviewed_at,
         approval_due_at, escalated_at,
         client_id, unit_label, building_name, community,
         property_type, developer_name,
         client:client_id(name),
         inspector:inspector_id(full_name, email),
         reviewer:reviewer_id(id, full_name, email),
         manager:approval_manager_id(id, full_name, email)`,
        { count: "exact" },
      );

    const status = params.get("status");
    if (status && status !== "all") query = query.in("status", status.split(","));

    const search = params.get("search")?.trim();
    if (search) {
      const term = `%${search}%`;
      query = query.or(
        [
          `code.ilike.${term}`,
          `unit_label.ilike.${term}`,
          `building_name.ilike.${term}`,
          `community.ilike.${term}`,
        ].join(","),
      );
    }

    const developer = params.get("developer");
    if (developer && developer !== "all") query = query.eq("developer_name", developer);

    const from = params.get("from");
    if (from) query = query.gte("scheduled_date", from);
    const to = params.get("to");
    if (to) query = query.lte("scheduled_date", to);

    if (params.get("queue") === "approval") {
      query = query
        .in("status", ["submitted", "in_review"])
        .order("submitted_at", { ascending: true, nullsFirst: false });
    } else {
      /*
        Newest first, by when the job was raised.

        The default was scheduled_date ascending, which put the oldest
        appointment at the top and buried a job created this morning
        somewhere in the middle of the list. Creation order is the one
        thing every record has, never changes, and matches what someone
        means by "the job I just made". A column the caller asks for
        still wins; this is only the default.
      */
      const sortByRaw = params.get("sortBy") ?? "created_at";
      const allowed = new Set(["scheduled_date", "code", "status", "created_at", "updated_at"]);
      const sortBy = allowed.has(sortByRaw) ? sortByRaw : "created_at";
      // Newest first for a date, A-Z for a label.
      const dateLike = sortBy === "created_at" || sortBy === "updated_at";
      const direction = params.get("sortDirection");
      const ascending = direction ? direction !== "desc" : !dateLike;
      query = query.order(sortBy, { ascending, nullsFirst: false });
    }

    // An inspector without All Records access only ever sees their own jobs.
    const assigneeId = params.get("assigneeId");
    if (assigneeId) query = query.eq("inspector_id", assigneeId);

    const { data, error, count } = await query.range(
      page * pageSize,
      page * pageSize + pageSize - 1,
    );
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as JobRow[];
    const enriched = await enrichRows(admin, rows);

    return NextResponse.json({ data: enriched, totalCount: count ?? 0 });
  } catch (error) {
    console.error("Snagging tasks GET error:", error);
    return NextResponse.json({ error: "Failed to load inspections" }, { status: 500 });
  }
}

type Joined = { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
type JobRow = {
  id: string;
  code: string;
  status: string;
  round_number: number;
  visit_type: string | null;
  parent_job_id: string | null;
  scheduled_date: string | null;
  locked: boolean;
  rejection_reason: string | null;
  rejection_category: string | null;
  rejection_count: number | null;
  remediation_due_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  approval_manager_id: string | null;
  // FR-6.01 / FR-6.07 — the review chain and its clock.
  reviewer_id: string | null;
  review_started_at: string | null;
  reviewed_at: string | null;
  approval_due_at: string | null;
  escalated_at: string | null;
  reviewer: Joined;
  manager: Joined;
  client_id: string | null;
  unit_label: string;
  building_name: string | null;
  community: string | null;
  property_type: string | null;
  developer_name: string | null;
  client: { name: string | null } | { name: string | null }[] | null;
  inspector: Joined;
};

function firstOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/** Adds the per-row counters and joined names the summary shape carries. */
async function enrichRows(admin: Admin, rows: JobRow[]) {
  if (rows.length === 0) return [];
  const jobIds = rows.map((r) => r.id);

  const [snags, areas, photos] = await Promise.all([
    admin.from("snagging_snags").select("job_id, severity, status").in("job_id", jobIds).neq("status", "withdrawn"),
    admin.from("snagging_areas").select("job_id, confirmed_at").in("job_id", jobIds),
    admin.from("snagging_snag_photos").select("job_id").in("job_id", jobIds),
  ]);
  if (snags.error) throw new Error(snags.error.message);
  if (areas.error) throw new Error(areas.error.message);
  if (photos.error) throw new Error(photos.error.message);

  const zero = () => ({ snag: 0, high: 0, medium: 0, low: 0, open: 0 });
  const snagAgg = new Map<string, ReturnType<typeof zero>>();
  for (const s of (snags.data ?? []) as Array<{ job_id: string; severity: string; status: string }>) {
    const a = snagAgg.get(s.job_id) ?? zero();
    a.snag += 1;
    if (s.severity === "high") a.high += 1;
    else if (s.severity === "medium") a.medium += 1;
    else if (s.severity === "low") a.low += 1;
    if (s.status === "open" || s.status === "pending_verification") a.open += 1;
    snagAgg.set(s.job_id, a);
  }

  const areaAgg = new Map<string, { total: number; confirmed: number }>();
  for (const ar of (areas.data ?? []) as Array<{ job_id: string; confirmed_at: string | null }>) {
    const a = areaAgg.get(ar.job_id) ?? { total: 0, confirmed: 0 };
    a.total += 1;
    if (ar.confirmed_at) a.confirmed += 1;
    areaAgg.set(ar.job_id, a);
  }

  const photoAgg = new Map<string, number>();
  for (const p of (photos.data ?? []) as Array<{ job_id: string }>) {
    photoAgg.set(p.job_id, (photoAgg.get(p.job_id) ?? 0) + 1);
  }

  const now = Date.now();
  return rows.map((row) => {
    const s = snagAgg.get(row.id) ?? zero();
    const ar = areaAgg.get(row.id) ?? { total: 0, confirmed: 0 };
    const client = firstOf(row.client);
    const insp = firstOf(row.inspector);
    /*
      FR-6.07 — the 48h approval SLA.

      The deadline is now stored on the row when the job is submitted, so
      the escalation sweep can index it and a job keeps the deadline it was
      actually given. It is still derived here for rows written before the
      column existed, so a historical job does not read as having no
      deadline at all.
    */
    const submittedMs = row.submitted_at ? Date.parse(row.submitted_at) : NaN;
    const approvalDueAt =
      row.approval_due_at ??
      (Number.isNaN(submittedMs)
        ? null
        : new Date(submittedMs + APPROVAL_SLA_HOURS * 60 * 60 * 1000).toISOString());
    const awaitingDecision = row.status === "submitted" || row.status === "in_review";
    // Stamped by the sweep, or past the deadline and not yet swept. Either
    // way the queue shows it as late rather than waiting on the scheduler.
    const escalated =
      Boolean(row.escalated_at) ||
      (awaitingDecision && approvalDueAt !== null && Date.parse(approvalDueAt) < now);
    return {
      id: row.id,
      code: row.code,
      status: row.status,
      task_type: "single_unit",
      round_number: row.round_number,
      visit_type: (row.visit_type ?? "initial") as SnaggingVisitType,
      parent_task_id: row.parent_job_id,
      scheduled_date: row.scheduled_date,
      scheduled_start_at: null,
      scheduled_end_at: null,
      package_name: null,
      service_tier: null,
      locked: row.locked,
      rejection_category: row.rejection_category ?? null,
      rejection_reason: row.rejection_reason,
      rejection_count: row.rejection_count ?? 0,
      remediation_due_at: row.remediation_due_at ?? null,
      approval_due_at: approvalDueAt,
      escalated,
      submitted_at: row.submitted_at,
      approved_at: row.approved_at,
      delivered_at: null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      supervisor_id: null,
      approval_manager_id: row.approval_manager_id,
      reviewer_id: row.reviewer_id ?? null,
      reviewer: firstOf(row.reviewer) ?? null,
      manager: firstOf(row.manager) ?? null,
      review_started_at: row.review_started_at ?? null,
      reviewed_at: row.reviewed_at ?? null,
      escalated_at: row.escalated_at ?? null,
      property_id: row.client_id ?? row.id,
      unit_label: row.unit_label,
      building_name: row.building_name,
      community: row.community,
      property_type: row.property_type,
      client_name: client?.name ?? "",
      developer_name: row.developer_name,
      area_count: ar.total,
      confirmed_area_count: ar.confirmed,
      snag_count: s.snag,
      high_severity_count: s.high,
      open_snag_count: s.open,
      photo_count: photoAgg.get(row.id) ?? 0,
      inspector_name: insp?.full_name ?? insp?.email ?? null,
      medium_severity_count: s.medium,
      low_severity_count: s.low,
    };
  });
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.CREATE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = createTaskSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;
    const p = input.property;
    if (!p) {
      return NextResponse.json({ error: "Provide client and unit details" }, { status: 400 });
    }

    const admin = await createAdminServerClient();

    // 1. Resolve the client. A client the picker already persisted arrives
    // by id; otherwise find-or-create one from the typed details.
    const clientId =
      input.client_id ??
      (await resolveClient(admin, {
        name: p.client_name,
        email: emptyToNull(p.client_email),
        phone: emptyToNull(p.client_phone),
        createdBy: profile.id,
      }));

    // 1b. Resolve the property record (BR-1). Reuses the client's property
    // for this unit or creates one; the full attributes live there now. The
    // job keeps only a 5-field snapshot for the list search and mobile wire.
    const property = await resolveProperty(admin, {
      propertyId: input.property_id ?? null,
      clientId,
      fields: p,
      createdBy: profile.id,
    });
    const snapshot = propertySnapshot(property.columns);

    // 2. Create the job. The unique index on `code` is the arbiter.
    // An inspector is NOT assigned here (FR-3.08): assignment is gated on the
    // client approving the quotation, and happens from the job afterwards. A
    // brand-new job has no approved quotation, so it starts unassigned.
    const inspectorId = null;
    let job: { id: string; code: string } | null = null;
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 5 && !job; attempt += 1) {
      const code = generateTaskCode(p.unit_label, p.building_name);
      // Appointment carries date + time; scheduled_date stays in step for the
      // mobile list, derived from the appointment when one is given.
      const appointmentAt = emptyToNull(input.appointment_at);
      const scheduledDate = emptyToNull(input.scheduled_date) ?? (appointmentAt ? appointmentAt.slice(0, 10) : null);

      const { data, error } = await admin
        .from("snagging_jobs")
        .insert({
          // Jobs start as draft; approving the quotation unlocks assignment
          // and moves the job to `assigned` (BR-2, F6).
          code,
          status: "draft",
          client_id: clientId,
          property_id: property.id,
          // Denormalised snapshot for the list search + mobile wire; the full
          // property record lives in snagging_properties (BR-1).
          unit_label: snapshot.unit_label,
          building_name: snapshot.building_name,
          community: snapshot.community,
          property_type: snapshot.property_type,
          developer_name: snapshot.developer_name,
          // Assignment + schedule (I1-I4).
          inspector_id: inspectorId,
          approval_manager_id: input.approval_manager_id ?? null,
          appointment_at: appointmentAt,
          scheduled_date: scheduledDate,
          developer_contact_name: emptyToNull(input.developer_contact_name),
          developer_contact_phone: emptyToNull(input.developer_contact_phone),
          client_contact_name: emptyToNull(input.client_contact_name),
          client_contact_phone: emptyToNull(input.client_contact_phone),
          notes: emptyToNull(input.notes),
          created_by: profile.id,
        })
        .select("id, code")
        .single();
      if (!error) {
        job = data;
        break;
      }
      lastError = error.message;
      if (error.code !== "23505") throw new Error(error.message);
    }
    if (!job) throw new Error(lastError ?? "Could not allocate an inspection code");

    // 3. Areas from the explicit list the wizard sends.
    const areas = (input.areas ?? []).map((area, index) => ({
      job_id: job!.id,
      name: area.name,
      catalogue_area_code: area.catalogue_area_code ?? null,
      sort_order: (index + 1) * 10,
    }));
    if (areas.length > 0) {
      const { error: areaError } = await admin.from("snagging_areas").insert(areas);
      if (areaError) throw new Error(areaError.message);
    }

    // 4. Build the job checklist from the property type (N2, FR-3.10).
    await generateChecklist(admin, job.id, p.property_type);

    return NextResponse.json({ data: { id: job.id, code: job.code } }, { status: 201 });
  } catch (error) {
    console.error("Snagging tasks POST error:", error);
    return NextResponse.json({ error: "Failed to create inspection" }, { status: 500 });
  }
}

/** Finds a client by name+email, or creates one. Returns its id. */
async function resolveClient(
  admin: Admin,
  input: { name: string; email: string | null; phone: string | null; createdBy: string },
): Promise<string> {
  const { data: existing } = await admin
    .from("snagging_clients")
    .select("id, email")
    .ilike("name", input.name)
    .limit(20);
  const match = (existing ?? []).find(
    (c: { id: string; email: string | null }) =>
      (c.email ?? "").toLowerCase() === (input.email ?? "").toLowerCase(),
  );
  if (match) return match.id;

  const { data, error } = await admin
    .from("snagging_clients")
    .insert({ name: input.name, email: input.email, phone: input.phone, created_by: input.createdBy })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Copies the applicable library checks onto a job as its checklist (N2). */
async function generateChecklist(admin: Admin, jobId: string, propertyType: string) {
  const appliesColumn =
    propertyType === "villa"
      ? "applies_villa"
      : propertyType === "townhouse"
        ? "applies_townhouse"
        : propertyType === "commercial"
          ? "applies_commercial"
          : "applies_apartment";

  const { data: items, error } = await admin
    .from("snagging_checklist_items")
    .select("id, code, group_name, label, mandatory, sort_order")
    .eq("active", true)
    .eq(appliesColumn, true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  if (!items || items.length === 0) return;

  const rows = items.map((item) => ({
    job_id: jobId,
    checklist_item_id: item.id,
    code: item.code,
    group_name: item.group_name,
    label: item.label,
    mandatory: item.mandatory,
    status: "pending" as const,
    sort_order: item.sort_order,
  }));
  const { error: insertError } = await admin
    .from("snagging_job_checklist")
    .upsert(rows, { onConflict: "job_id,code", ignoreDuplicates: true });
  if (insertError) throw new Error(insertError.message);
}
