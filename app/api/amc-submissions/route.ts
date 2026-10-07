import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { hasResourceAction } from "@/lib/role-permissions";
import { canApproveAmc } from "@/components/dashboard/extensions/amc/amc-settings";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { priceSubmission } from "@/lib/server/amc/pricing";
import { canDecideProposal } from "@/lib/amc/workflow";
import {
  amcServiceRowsInputSchema,
  discountPercentSchema,
} from "@/lib/amc/pricing";
import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import {
  AMC_STATUSES,
  isAmcSubmissionEditable,
} from "@/components/dashboard/extensions/amc/amc-types";
import { likeTerm, pageParams } from "@/lib/server/snagging/search";
import { todayInDubai } from "@/lib/amc/contracts";
import { UNIT_TYPES } from "@/lib/amc/client-profile";
import {
  PAYMENT_PLANS,
  customPlanSchema,
  legacyTermsForPlan,
  planFromLegacyTerms,
  type PaymentPlan,
} from "@/lib/amc/proposal-rules";
import { rateCardInForce } from "@/lib/server/amc/rate-card";
import { ActionType, ResourceType } from "@/types/types";
import type {
  AmcDocumentType,
  AmcSubmission,
  AmcSubmissionStatus,
} from "@/components/dashboard/extensions/amc/amc-types";

const DOCUMENT_TYPES = ["proposal", "contract"] as const;

const coordinationContactSchema = z.object({
  name: z.string(),
  phone: z.string(),
  designation: z.enum(["owner", "tenant", "representative"]),
});

const priceListRowSchema = z.object({
  category: z.string(),
  description: z.string(),
  brand: z.string(),
  price: z.string(),
});

const accountManagerSchema = z.object({
  name: z.string(),
  phone: z.string(),
});

const submissionPayloadSchema = z.object({
  property: z.object({
    propertyCategory: z.enum(["residential", "commercial"]),
    unitType: z.enum(["villa", "apartment", "office"]),
    propertyAddress: z.string(),
    propertyDetail: z.string(),
    /* BRD 5.2's full list (Phase 4); unitType above stays the rate model. */
    propertyType: z.enum(UNIT_TYPES).optional(),
  }),
  customer: z.object({
    customerName: z.string(),
    customerId: z.string().optional(),
    customerPhone: z.string(),
    customerEmail: z.string(),
    coordinationContacts: z.tuple([coordinationContactSchema, coordinationContactSchema]),
    startDate: z.string(),
    endDate: z.string(),
    paymentTerms: z.enum(["monthly", "quarterly", "annual"]),
    proposalNumber: z.string(),
  }),
  /* FR3.1/FR4.5/FR4.6. Optional on the payload so a submission saved
     before these existed still validates on update. */
  document_options: z
    .object({
      optionalSections: z.object({
        supplyInstallPriceList: z.boolean(),
        additionalFixedPriceServices: z.boolean(),
      }),
      priceListRows: z.array(priceListRowSchema),
      accountManagers: z.tuple([accountManagerSchema, accountManagerSchema]),
    })
    .optional(),
  /* FR2.4: rows as entered. basePrice is nullable -- a draft row the team
     has not priced yet is saved unpriced, and must not come back as a
     free service. Validation lives with the pricing (lib/amc/pricing.ts). */
  services: amcServiceRowsInputSchema,
  discount_percent: discountPercentSchema,
  /* Sent by older clients; ignored. The server derives both from the
     rows and the discount (lib/server/amc/pricing.ts). */
  discount_amount: z.number().optional(),
  final_price: z.number().optional(),
  generated_documents: z.array(z.enum(DOCUMENT_TYPES)).optional(),
  /* DEV-366: replaces monthly/quarterly/annual; customer.paymentTerms is kept as a compatible reading. */
  payment_plan: z.enum(PAYMENT_PLANS).optional(),
  payment_plan_custom: customPlanSchema.nullable().optional(),
});

const submissionUpdateSchema = submissionPayloadSchema.partial().extend({
  id: z.string().uuid(),
});

/*
  What the LIST needs: everything the table draws and every row action
  decides from.

  Deliberately without `services`, `document_options` and the two settings
  snapshots -- four JSON blobs per proposal, the whole of a contract's
  wording among them -- because the list draws none of them. They are read
  by the preview, the download and the email, which now fetch the one
  proposal they are working on (use-amc-actions.tsx).
*/
const LIST_COLUMNS =
  "id, owner_id, proposal_number, status, property, customer, " +
  "discount_percent, discount_amount, final_price, generated_documents, " +
  "submitted_at, decided_at, sent_back_reason, proposal_sent_at, contract_sent_at, " +
  "client_decision, client_decided_at, client_decided_by_name, client_rejected_reason, " +
  "signed_by_name, signed_at, created_at, updated_at";
/* The Phase 4 header fields (20261007140000); the list falls back without them. */
const LIST_COLUMNS_V2 = `${LIST_COLUMNS}, current_version, payment_plan, valid_until, enquiry_id, below_floor`;
const PHASE4_COLUMNS = [
  "property_type",
  "payment_plan",
  "payment_plan_custom",
  "rate_card_version_id",
  "below_floor",
] as const;
const missingColumn = (error: { code?: string } | null | undefined) =>
  error?.code === "42703" || error?.code === "PGRST204";

/*
  Writes a row, and again without the Phase 4 columns when the database
  does not have them yet -- so proposals keep saving on a database where
  20261007140000 is not applied (the plan's per-file apply order).
*/
async function withPhase4Fallback<T>(
  row: Record<string, unknown>,
  run: (row: Record<string, unknown>) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>,
) {
  const first = await run(row);
  if (!first.error || !missingColumn(first.error)) return first;
  const legacy = { ...row };
  for (const column of PHASE4_COLUMNS) delete legacy[column];
  return run(legacy);
}

/* The plan a payload carries, and the legacy terms live main prints for it. */
function planFields(payload: { payment_plan?: PaymentPlan; payment_plan_custom?: unknown }) {
  if (!payload.payment_plan) return {};
  return {
    payment_plan: payload.payment_plan,
    payment_plan_custom: payload.payment_plan === "custom" ? (payload.payment_plan_custom ?? null) : null,
  };
}

/* The card in force today, or null (none published, or the update not applied). */
async function pricingCard(admin: Awaited<ReturnType<typeof createAdminServerClient>>) {
  try {
    const version = await rateCardInForce(admin);
    return version ? { id: version.id, card: version.card } : null;
  } catch (error) {
    console.error("AMC rate card read failed; pricing as entered:", error);
    return null;
  }
}

type AmcSubmissionRow = {
  id: string;
  owner_id: string;
  /* Server-allocated from amc_proposal_number_seq (step 1.7). */
  proposal_number: string;
  status: AmcSubmissionStatus;
  property: AmcSubmission["property"];
  customer: AmcSubmission["customer"];
  /* The four below are absent on a list row; see LIST_COLUMNS. */
  document_options?: AmcSubmission["document_options"];
  services?: AmcSubmission["services"];
  discount_percent: number;
  discount_amount: number;
  final_price: number;
  generated_documents: AmcDocumentType[];
  settings_snapshot?: AmcSubmission["settings_snapshot"];
  contract_settings_snapshot?: AmcSubmission["contract_settings_snapshot"];
  submitted_at: string | null;
  decided_at: string | null;
  sent_back_reason: string | null;
  /* Absent until the client-links migration is applied. */
  proposal_sent_at?: string | null;
  contract_sent_at?: string | null;
  client_decision?: "approved" | "rejected" | null;
  client_decided_at?: string | null;
  client_decided_by_name?: string | null;
  client_rejected_reason?: string | null;
  signed_by_name?: string | null;
  signed_at?: string | null;
  created_at: string;
  updated_at: string;
  /* Phase 4 (20261007140000); absent before it is applied. */
  property_type?: string | null;
  payment_plan?: string | null;
  payment_plan_custom?: unknown;
  valid_until?: string | null;
  current_version?: number | null;
  version_reason?: string | null;
  version_summary?: string | null;
  version_started_at?: string | null;
  enquiry_id?: string | null;
  below_floor?: boolean | null;
  rate_card_version_id?: string | null;
};

function mapRow(
  row: AmcSubmissionRow,
  owner?: { viewerId: string; names: Map<string, string> },
): AmcSubmission {
  return {
    ...(owner
      ? {
          owner_name: owner.names.get(row.owner_id) ?? null,
          is_own: row.owner_id === owner.viewerId,
        }
      : {}),
    id: row.id,
    owner_id: row.owner_id,
    status: row.status,
    property: row.property,
    customer: { ...row.customer, proposalNumber: row.proposal_number },
    document_options: row.document_options,
    services: row.services ?? [],
    discount_percent: Number(row.discount_percent),
    discount_amount: Number(row.discount_amount),
    final_price: Number(row.final_price),
    generated_documents: row.generated_documents ?? [],
    settings_snapshot: row.settings_snapshot ?? null,
    contract_settings_snapshot: row.contract_settings_snapshot ?? null,
    submitted_at: row.submitted_at ?? null,
    decided_at: row.decided_at ?? null,
    sent_back_reason: row.sent_back_reason ?? null,
    proposal_sent_at: row.proposal_sent_at ?? null,
    contract_sent_at: row.contract_sent_at ?? null,
    client_decision: row.client_decision ?? null,
    client_decided_at: row.client_decided_at ?? null,
    client_decided_by_name: row.client_decided_by_name ?? null,
    client_rejected_reason: row.client_rejected_reason ?? null,
    signed_by_name: row.signed_by_name ?? null,
    signed_at: row.signed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    property_type: row.property_type ?? null,
    /* An older proposal reads its legacy terms as a plan (issue #8). */
    payment_plan: (row.payment_plan as PaymentPlan | null) ?? planFromLegacyTerms(row.customer?.paymentTerms),
    payment_plan_custom: (row.payment_plan_custom as AmcSubmission["payment_plan_custom"]) ?? null,
    valid_until: row.valid_until ?? null,
    current_version: Number(row.current_version ?? 1),
    version_reason: (row.version_reason as AmcSubmission["version_reason"]) ?? null,
    version_summary: row.version_summary ?? null,
    version_started_at: row.version_started_at ?? null,
    enquiry_id: row.enquiry_id ?? null,
    below_floor: row.below_floor === true,
    rate_card_version_id: row.rate_card_version_id ?? null,
  };
}

type AmcAccess = Awaited<ReturnType<typeof getAuthenticatedUserAccess>>;

type AmcAccessResult =
  | {
      ok: true;
      profile: NonNullable<AmcAccess["profile"]>;
      /* Carried through so the list route can check role_access for the
         approver queue (FR3.2/FR5.3) without a second lookup. */
      accessUser: NonNullable<AmcAccess["accessUser"]>;
    }
  | { ok: false; error: NextResponse };

async function requireAmcAccess(): Promise<AmcAccessResult> {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile || !access.accessUser) {
    return {
      ok: false,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!canUseAmc(access.accessUser)) {
    return {
      ok: false,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, profile: access.profile, accessUser: access.accessUser };
}

export async function GET(req: NextRequest) {
  const gate = await requireAmcAccess();
  if (!gate.ok) return gate.error;

  const { profile } = gate;
  const admin = await createAdminServerClient();
  const id = req.nextUrl.searchParams.get("id");

  if (id) {
    /*
      One submission, for its detail page or the wizard.

      The same visibility as the list (FR3.2): the owner, or an approver
      for anything past draft. It used to be owner-only, so an approver
      opening a proposal from the queue would have been told it did not
      exist. The row and the settings that decide approval rights are read
      together rather than one after the other.
    */
    const [{ data, error }, settings] = await Promise.all([
      admin.from("amc_submissions").select("*").eq("id", id).maybeSingle(),
      readAmcSettings(admin),
    ]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const row = data as AmcSubmissionRow;
    const canApprove = canApproveAmc(
      settings,
      profile.email,
      hasResourceAction(gate.accessUser, ResourceType.AMC, ActionType.APPROVE),
    );
    const isOwn = row.owner_id === profile.id;
    /* DEV-368: approvers and AMC Operations (View) see the team's proposals. */
    const seesTeam = canApprove || hasResourceAction(gate.accessUser, ResourceType.AMC_OPERATIONS, ActionType.VIEW);
    // Someone else's draft stays private, even to an approver.
    if (!isOwn && (!seesTeam || row.status === "draft")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const names = new Map<string, string>();
    if (!isOwn) {
      const { data: owner } = await admin
        .from("user_profile")
        .select("id, full_name, email")
        .eq("id", row.owner_id)
        .maybeSingle();
      if (owner) {
        names.set(
          String(owner.id),
          ((owner.full_name as string | null) ?? "").trim() ||
            String(owner.email ?? ""),
        );
      }
    }

    /* Active AMC: the contract made from this proposal, if any. A
       database without the contracts table reports nothing. */
    let contractId: string | null | undefined;
    if (row.status === "signed") {
      const { data: contract, error: contractError } = await admin
        .from("amc_contracts")
        .select("id")
        .eq("submission_id", row.id)
        .maybeSingle<{ id: string }>();
      contractId = contractError ? undefined : (contract?.id ?? null);
    }

    return NextResponse.json({
      ...mapRow(row, { viewerId: profile.id, names }),
      contract_id: contractId,
      /* One rule for the API and the buttons (lib/amc/workflow.ts),
         including whether a creator may approve their own proposal. */
      viewer_can_approve: canDecideProposal({
        canApprove,
        isOwner: row.owner_id === profile.id,
      }),
    });
  }

  /*
    FR3.2: "My AMC Submissions shows each user their own submissions. The
    approver also sees every submission sent for review." An approver sees
    them through the whole life of the proposal, not only while it waits:
    what they approved, sent back, and what the client did with it. Other
    people's drafts stay private.

    One page at a time, counted by the database.

    This used to read every proposal the viewer could see -- their own and,
    for an approver, the whole queue -- in two unbounded reads, union them
    here and send the lot, and the table then sliced a page out of it in
    the browser. Every visit downloaded the entire history to draw ten
    rows, the search only ever looked at what had already arrived, and the
    two reads stopped silently at the API's 1,000-row cap. Now the filters,
    the search and the page are applied in one ordered query, and the
    total comes back with it.

    That means the owner clause and the approver clause have to be one
    filter again ("mine, or anyone's past draft"). It is spelled out in
    visibilityClauses below, the one place it lives.
  */
  const params = req.nextUrl.searchParams;
  const { from, to } = pageParams(params, { defaultSize: 10, maxSize: 100 });
  const statusParam = params.get("status");
  const status = (AMC_STATUSES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as AmcSubmissionStatus)
    : null;
  const mineOnly = params.get("scope") === "mine";
  const term = likeTerm(params.get("search"));

  /* FR5.3: the approvers chosen in AMC Settings, or the role permission
     when none are chosen. Read first, because it decides which rows the
     queries below may return. */
  const settings = await readAmcSettings(admin);
  const canApprove = canApproveAmc(
    settings,
    profile.email,
    hasResourceAction(gate.accessUser, ResourceType.AMC, ActionType.APPROVE),
  );

  /*
    Whose proposals: always the caller's own; for an approver, also anyone
    else's once it has left draft. Null means "only mine", applied as a
    plain equality rather than an `or`.
  */
  /* DEV-368 (BRD 5.4): approvers and AMC Operations (View) see the team's proposals; others their own. */
  const seesTeam = canApprove || hasResourceAction(gate.accessUser, ResourceType.AMC_OPERATIONS, ActionType.VIEW);
  const visibilityClauses =
    seesTeam && !mineOnly ? [`owner_id.eq.${profile.id}`, "status.neq.draft"] : null;

  /*
    The search box: the customer, the proposal number, the address -- and,
    for an approver, who raised it. A name lives on user_profile, so the
    people who match are found first and their proposals matched by id,
    the same way the Quotations list finds a client's quotations.
  */
  let searchClauses: string[] | null = null;
  if (term) {
    let ownerIds: string[] = [];
    if (seesTeam) {
      const { data: owners, error: ownerError } = await admin
        .from("user_profile")
        .select("id")
        .or(`full_name.ilike.${term},email.ilike.${term}`)
        .limit(200);
      if (ownerError) {
        return NextResponse.json({ error: ownerError.message }, { status: 500 });
      }
      ownerIds = (owners ?? []).map((row) => String(row.id));
    }
    searchClauses = [
      `customer->>customerName.ilike.${term}`,
      `proposal_number.ilike.${term}`,
      `property->>propertyAddress.ilike.${term}`,
      ...(ownerIds.length ? [`owner_id.in.(${ownerIds.join(",")})`] : []),
    ];
  }

  /*
    The two groups as ONE `or` filter, (visible) AND (matches the search).
    Written out as "each search clause AND visible" so the query carries a
    single documented logic tree rather than two `or` parameters whose
    combination is easy to get subtly wrong in a way that leaks drafts.
  */
  const orFilter =
    visibilityClauses && searchClauses
      ? searchClauses
          .map((clause) => `and(${clause},or(${visibilityClauses.join(",")}))`)
          .join(",")
      : (visibilityClauses ?? searchClauses)?.join(",") ?? null;

  /*
    Newest proposal first, by when it was RAISED.

    It used to lift everything awaiting approval to the top and then order
    what was left by when it was last touched, so the list read as though
    it had no order at all: a proposal raised on the 21st sat above one
    raised on the 25th, and editing an old draft jumped it over newer
    ones. Approvers have the Approvals queue for what needs deciding;
    this list is the record of what has been raised. The id breaks ties so
    a row can never appear on two pages.
  */
  const pageQueryWith = (columns: string) => {
    let query = admin
      .from("amc_submissions")
      .select(columns, { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to);
    if (!visibilityClauses) query = query.eq("owner_id", profile.id);
    if (orFilter) query = query.or(orFilter);
    if (status) query = query.eq("status", status);
    return query;
  };
  const pageQuery = pageQueryWith(LIST_COLUMNS_V2).then(async (result) =>
    result.error && missingColumn(result.error) ? pageQueryWith(LIST_COLUMNS) : result,
  );

  /*
    How many proposals sit in each status, for the status filter's counts.
    They follow the scope and the search but not the status picked, so the
    other options still say how many they would show.
  */
  const countFor = async (value: AmcSubmissionStatus | null) => {
    let counter = admin
      .from("amc_submissions")
      .select("id", { count: "exact", head: true });
    if (!visibilityClauses) counter = counter.eq("owner_id", profile.id);
    if (orFilter) counter = counter.or(orFilter);
    if (value) counter = counter.eq("status", value);
    const { count, error: countError } = await counter;
    if (countError) throw new Error(countError.message);
    return count ?? 0;
  };

  let results;
  try {
    results = await Promise.all([
      pageQuery,
      countFor(null),
      ...AMC_STATUSES.map((value) => countFor(value)),
    ]);
  } catch (countError) {
    return NextResponse.json(
      { error: countError instanceof Error ? countError.message : "Could not count proposals" },
      { status: 500 },
    );
  }

  const [{ data, error, count }, all, ...byStatus] = results;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as AmcSubmissionRow[];

  // Names for the "Submitted by" column, for this page's owners only.
  const ownerIds = [...new Set(rows.map((row) => row.owner_id))];
  const names = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: owners } = await admin
      .from("user_profile")
      .select("id, full_name, email")
      .in("id", ownerIds);
    for (const owner of owners ?? []) {
      names.set(
        String(owner.id),
        ((owner.full_name as string | null) ?? "").trim() ||
          String(owner.email ?? ""),
      );
    }
  }

  const submissions = rows.map((row) =>
    mapRow(row, { viewerId: profile.id, names }),
  );
  return NextResponse.json({
    submissions,
    totalCount: count ?? 0,
    counts: {
      all,
      ...Object.fromEntries(AMC_STATUSES.map((value, i) => [value, byStatus[i]])),
    } as Record<string, number>,
    canApprove,
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireAmcAccess();
  if (!gate.ok) return gate.error;

  const { profile } = gate;
  const parsed = submissionPayloadSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const payload = parsed.data;
  const admin = await createAdminServerClient();
  const now = new Date().toISOString();

  const settings = await readSettingsOr503(admin);
  if ("error" in settings) return settings.error;

  /* The server prices the proposal; totals in the request are ignored.
     With a rate card in force, the base prices are the card's (BRD 5.3). */
  const card = await pricingCard(admin);
  const priced = priceSubmission({
    services: payload.services,
    discountPercent: payload.discount_percent,
    unitType: payload.property.unitType,
    settings: settings.value,
    rateCard: card,
    day: todayInDubai(),
  });
  if (!priced.ok) {
    return NextResponse.json({ error: priced.error }, { status: 400 });
  }

  const { data, error } = await withPhase4Fallback(
    {
      owner_id: profile.id,
      /* Always draft. It advances only through the approval route. */
      status: "draft",
      property: payload.property,
      customer: payload.payment_plan
        ? { ...payload.customer, paymentTerms: legacyTermsForPlan(payload.payment_plan) }
        : payload.customer,
      document_options: payload.document_options,
      services: priced.services,
      discount_percent: priced.discount_percent,
      discount_amount: priced.discount_amount,
      final_price: priced.final_price,
      generated_documents: payload.generated_documents ?? [],
      updated_at: now,
      ...(payload.property.propertyType ? { property_type: payload.property.propertyType } : {}),
      ...planFields(payload),
      ...(card ? { rate_card_version_id: priced.rate_card_version_id, below_floor: priced.below_floor } : {}),
    },
    (row) => admin.from("amc_submissions").insert(row).select("*").single(),
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  /*
    The number is allocated by the INSERT, so the copy inside customer can
    only be pinned afterwards. Without this it kept whatever the form sent
    (usually "") until the first edit.
  */
  let row = data as unknown as AmcSubmissionRow;
  const jsonNumber = (row.customer as { proposalNumber?: string } | null)?.proposalNumber;
  if (jsonNumber !== row.proposal_number) {
    const { data: pinned } = await admin
      .from("amc_submissions")
      .update({ customer: { ...(row.customer as object), proposalNumber: row.proposal_number } })
      .eq("id", row.id)
      .select("*")
      .single();
    if (pinned) row = pinned as AmcSubmissionRow;
  }

  return NextResponse.json({ ...mapRow(row), rate_problems: priced.rateProblems }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const gate = await requireAmcAccess();
  if (!gate.ok) return gate.error;

  const { profile } = gate;
  const parsed = submissionUpdateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { id, ...updates } = parsed.data;
  const admin = await createAdminServerClient();

  const { data: existing, error: fetchError } = await admin
    .from("amc_submissions")
    .select("*")
    .eq("id", id)
    .eq("owner_id", profile.id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const existingRow = existing as AmcSubmissionRow;

  /*
    FR3.4 — "Once it is sent for review it is locked, until it is approved
    or sent back." Enforced here and not only in the UI: the autosave
    fires on a timer, and a submission approved in another tab while this
    one still had the wizard open would otherwise be silently rewritten
    after the decision was made.
  */
  if (!isAmcSubmissionEditable(existingRow.status)) {
    return NextResponse.json(
      {
        error: `This proposal is ${existingRow.status.replace(/_/g, " ")} and can no longer be edited.`,
      },
      { status: 409 },
    );
  }
  const mergedDocuments = updates.generated_documents
    ? Array.from(
        new Set([
          ...(existingRow.generated_documents ?? []),
          ...updates.generated_documents,
        ]),
      )
    : existingRow.generated_documents;

  /*
    Re-price whenever anything that affects the price arrives. Rows,
    discount or property type missing from this request come from the
    saved proposal, so a partial update cannot leave stale totals.
  */
  let pricedFields: Partial<
    Pick<
      AmcSubmissionRow,
      "services" | "discount_percent" | "discount_amount" | "final_price" | "rate_card_version_id" | "below_floor"
    >
  > = {};
  let rateProblems: string[] = [];
  if (
    updates.services !== undefined ||
    updates.discount_percent !== undefined ||
    updates.property !== undefined
  ) {
    const existingProperty = existingRow.property as { unitType?: string } | null;
    const settings = await readSettingsOr503(admin);
    if ("error" in settings) return settings.error;
    /* A draft is priced on today's card each time it is saved; a shared
       version is locked and keeps its own (DEV-364, 367). */
    const card = await pricingCard(admin);
    const priced = priceSubmission({
      services: (updates.services ?? existingRow.services ?? []) as Parameters<
        typeof priceSubmission
      >[0]["services"],
      discountPercent: updates.discount_percent ?? Number(existingRow.discount_percent ?? 0),
      unitType: updates.property?.unitType ?? existingProperty?.unitType ?? "",
      settings: settings.value,
      rateCard: card,
      day: todayInDubai(),
    });
    if (!priced.ok) {
      return NextResponse.json({ error: priced.error }, { status: 400 });
    }
    pricedFields = {
      services: priced.services as AmcSubmissionRow["services"],
      discount_percent: priced.discount_percent,
      discount_amount: priced.discount_amount,
      final_price: priced.final_price,
      ...(card ? { rate_card_version_id: priced.rate_card_version_id, below_floor: priced.below_floor } : {}),
    };
    rateProblems = priced.rateProblems;
  }
  /* Never stored as sent: derived above, or left as saved. */
  delete updates.discount_amount;
  delete updates.final_price;

  /* Pin the JSONB copy to the allocated number, whatever the form sent,
     so the two cannot drift apart through an edit. */
  if (updates.customer) {
    updates.customer = {
      ...updates.customer,
      proposalNumber: existingRow.proposal_number,
      ...(updates.payment_plan ? { paymentTerms: legacyTermsForPlan(updates.payment_plan) } : {}),
    };
  }
  const { payment_plan, payment_plan_custom, ...rest } = updates;
  const propertyType = rest.property?.propertyType;

  const { data, error } = await withPhase4Fallback(
    {
      ...rest,
      ...pricedFields,
      ...(propertyType ? { property_type: propertyType } : {}),
      ...planFields({ payment_plan, payment_plan_custom }),
      generated_documents: mergedDocuments,
      updated_at: new Date().toISOString(),
    },
    (row) =>
      admin
        .from("amc_submissions")
        .update(row)
        .eq("id", id)
        .eq("owner_id", profile.id)
        /* Re-asserted: an autosave that lands just after an approval must not
           rewrite the approved proposal. */
        .in("status", EDITABLE_STATUSES)
        .select("*")
        .maybeSingle(),
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "This proposal changed status a moment ago and can no longer be edited. Reload it." },
      { status: 409 },
    );
  }

  return NextResponse.json({ ...mapRow(data as AmcSubmissionRow), rate_problems: rateProblems });
}

/*
  What PUT may still write over (isAmcSubmissionEditable). A proposal the
  client has seen is changed through a new version (BRD 5.4, DEV-367), so a
  rejected one is revised rather than edited in place.
*/
const EDITABLE_STATUSES = ["draft", "sent_back"];

/* AMC Settings decide what may be priced; if they cannot be read, say so
   as JSON rather than failing with an HTML 500. */
async function readSettingsOr503(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
): Promise<{ value: Awaited<ReturnType<typeof readAmcSettings>> } | { error: NextResponse }> {
  try {
    return { value: await readAmcSettings(admin) };
  } catch (error) {
    console.error("AMC settings read failed:", error);
    return {
      error: NextResponse.json(
        { error: "AMC Settings could not be loaded, so the proposal was not saved. Try again." },
        { status: 503 },
      ),
    };
  }
}
