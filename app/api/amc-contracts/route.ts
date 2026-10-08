import { NextRequest, NextResponse } from "next/server";
import { canActivateContract } from "@/lib/amc/access";
import { z } from "zod";

import {
  DEFAULT_EXPIRING_WINDOW_DAYS,
  daysRemaining,
  expiryLabel,
  shiftDays,
  summarizeContract,
  todayInDubai,
  type EntitlementType,
} from "@/lib/amc/contracts";
import { grandTotalFromFinal } from "@/lib/amc/pricing";
import {
  contractErrorResponse,
  requireContractAccess,
} from "@/lib/server/amc/contract-access";
import {
  CONTRACT_COLUMNS,
  activateContract,
  isMissingTable,
  mapContract,
} from "@/lib/server/amc/contracts";
import { loadPendingActivations } from "@/lib/server/amc/contract-operations";
import { readAmcConfig } from "@/lib/server/amc/config";
import { gateAfterOneStepActivation } from "@/lib/server/amc/payments";
import { fetchAllRowsById } from "@/lib/server/amc/paging";
import { likeTerm, pageParams } from "@/lib/server/snagging/search";

/**
 * AMC contracts: the list (GET) and activation of a signed proposal (POST).
 *
 * List statuses are derived from the dates, not stored:
 *   pending_activation  signed proposals with no contract yet
 *   not_started         active, start date ahead
 *   active              running, more than the expiring window left
 *   expiring            running, ending within the window
 *   expired             past the end date
 *   cancelled
 *
 * Query: status, search (customer, customer ID, contract number, property,
 * account manager), manager, sort (contract | customer | property | start |
 * end | value), dir (asc | desc), page, pageSize.
 */

const LIST_STATUSES = [
  "all",
  "pending_activation",
  "not_started",
  "active",
  "expiring",
  "expired",
  "cancelled",
] as const;
type ListStatus = (typeof LIST_STATUSES)[number];

const SORT_COLUMNS = {
  contract: "proposal_number",
  customer: "customer_name",
  property: "property_label",
  start: "start_date",
  end: "end_date",
  value: "grand_total",
} as const;
type SortKey = keyof typeof SORT_COLUMNS;

type Row = Record<string, unknown>;

function managerNames(list: unknown): string[] {
  return (Array.isArray(list) ? list : [])
    .map((m) => String((m as Row)?.name ?? "").trim())
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { admin, userId } = gate;
  /* Every contract for approvers and AMC Operations; otherwise your own. */
  const canApprove = gate.seesAll;

  const params = req.nextUrl.searchParams;
  const statusParam = params.get("status") ?? "all";
  const status: ListStatus = (LIST_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as ListStatus)
    : "all";
  const term = likeTerm(params.get("search"));
  const manager = likeTerm(params.get("manager"));
  const sortParam = params.get("sort") ?? "end";
  const sort: SortKey = sortParam in SORT_COLUMNS ? (sortParam as SortKey) : "end";
  const ascending = params.get("dir") !== "desc";
  const { page, pageSize, from, to } = pageParams(params, { defaultSize: 10 });

  const today = todayInDubai();
  /* Last day of the "expiring" window (same default as the detail page). */
  const windowEnd = shiftDays(today, DEFAULT_EXPIRING_WINDOW_DAYS);

  /* Contracts query with the visibility rule and a derived-status filter.
     Two foreign keys join these tables (submission_id and
     amc_submissions.renewal_of_contract_id), so every embed names its key. */
  const contractQuery = (forStatus: ListStatus, head = false) => {
    let q = admin
      .from("amc_contracts")
      .select(
        head
          ? "id, amc_submissions!amc_contracts_submission_id_fkey!inner(owner_id)"
          : `${CONTRACT_COLUMNS}, amc_submissions!amc_contracts_submission_id_fkey!inner(owner_id), amc_contract_entitlements(entitlement_type, included_quantity, used_quantity)`,
        head ? { count: "exact", head: true } : { count: "exact" },
      );
    if (!canApprove) q = q.eq("amc_submissions.owner_id", userId);
    if (term) {
      q = q.or(
        `customer_name.ilike.${term},proposal_number.ilike.${term},property_label.ilike.${term},customer_ref.ilike.${term},account_manager_names.ilike.${term}`,
      );
    }
    if (manager) q = q.ilike("account_manager_names", manager);
    switch (forStatus) {
      case "cancelled":
        q = q.eq("status", "cancelled");
        break;
      case "expired":
        q = q.eq("status", "active").lt("end_date", today);
        break;
      case "not_started":
        q = q.eq("status", "active").gt("start_date", today);
        break;
      case "expiring":
        q = q
          .eq("status", "active")
          .lte("start_date", today)
          .gte("end_date", today)
          .lte("end_date", windowEnd);
        break;
      case "active":
        q = q.eq("status", "active").lte("start_date", today).gt("end_date", windowEnd);
        break;
      default:
        break;
    }
    return q;
  };

  /* Signed proposals waiting for activation, filtered like the contracts. */
  const loadPending = async () => {
    const rows = await loadPendingActivations(admin, { userId, canApprove });
    const needle = term ? term.slice(1, -1).toLowerCase() : "";
    const managerNeedle = manager ? manager.slice(1, -1).toLowerCase() : "";
    return rows
      .filter((row) => {
        const c = (row.customer ?? {}) as Row;
        const p = (row.property ?? {}) as Row;
        const managers = managerNames((row.document_options as Row | null)?.accountManagers);
        if (managerNeedle && !managers.some((m) => m.toLowerCase().includes(managerNeedle))) return false;
        if (!needle) return true;
        return [c.customerName, c.customerId, row.proposal_number, p.propertyAddress, p.propertyDetail, ...managers]
          .some((v) => typeof v === "string" && v.toLowerCase().includes(needle));
      })
      .map((row) => {
        const c = (row.customer ?? {}) as Row;
        const p = (row.property ?? {}) as Row;
        const start = typeof c.startDate === "string" ? c.startDate : null;
        const end = typeof c.endDate === "string" ? c.endDate : null;
        return {
          kind: "pending" as const,
          id: String(row.id),
          submissionId: String(row.id),
          proposalNumber: String(row.proposal_number ?? ""),
          customerName: String(c.customerName ?? ""),
          propertyLabel: [p.propertyDetail, p.propertyAddress].filter(Boolean).join(" — "),
          accountManagers: managerNames((row.document_options as Row | null)?.accountManagers),
          startDate: start,
          endDate: end,
          displayStatus: "pending_activation" as const,
          expiryLabel: "Waiting for activation",
          grandTotal: grandTotalFromFinal(Number(row.final_price ?? 0)),
          daysRemaining: end ? daysRemaining(end, today) : null,
          coverage: null,
          canActivate: canActivateContract(gate.actor, (row.owner_id as string | null) ?? null),
        };
      });
  };

  /* Account managers on the visible contracts, for the filter. */
  const loadManagers = async (): Promise<string[]> => {
    const { data, error } = await fetchAllRowsById<Row>((afterId, size) => {
      let q = admin
        .from("amc_contracts")
        .select("id, account_manager_names, amc_submissions!amc_contracts_submission_id_fkey!inner(owner_id)")
        .neq("account_manager_names", "")
        .order("id")
        .limit(size);
      if (afterId) q = q.gt("id", afterId);
      if (!canApprove) q = q.eq("amc_submissions.owner_id", userId);
      return q;
    });
    if (error) return [];
    const names = new Set<string>();
    for (const row of data) {
      String(row.account_manager_names ?? "")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
        .forEach((n) => names.add(n));
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  };

  try {
    const countStatuses: ListStatus[] = ["not_started", "active", "expiring", "expired", "cancelled"];
    const [pending, managers, ...countResults] = await Promise.all([
      loadPending(),
      loadManagers(),
      contractQuery("all", true),
      ...countStatuses.map((s) => contractQuery(s, true)),
    ]);
    const missing = countResults.find((r) => isMissingTable(r.error));
    if (missing) {
      return NextResponse.json(
        { error: "AMC contracts are not set up on this database yet (migration 20261006100000)." },
        { status: 503 },
      );
    }
    const failed = countResults.find((r) => r.error);
    if (failed?.error) throw failed.error;
    const contractTotal = countResults[0].count ?? 0;
    const counts: Record<string, number> = {
      all: contractTotal + pending.length,
      pending_activation: pending.length,
    };
    countStatuses.forEach((s, i) => {
      counts[s] = countResults[i + 1].count ?? 0;
    });
    const base = { counts, managers, canApprove: gate.canApprove, page, pageSize };

    if (status === "pending_activation") {
      return NextResponse.json({ ...base, rows: pending.slice(from, to + 1), totalCount: pending.length });
    }

    /* "All" lists what is waiting for activation first, then contracts:
       one continuous list, paged as a whole. */
    const lead = status === "all" ? pending : [];
    const leadRows = lead.slice(from, to + 1);
    const contractFrom = Math.max(0, from - lead.length);
    const contractTo = to - lead.length;

    let contractRows: Row[] = [];
    let contractCount = status === "all" ? contractTotal : 0;
    if (contractTo >= 0) {
      const { data, error, count } = await contractQuery(status)
        .order(SORT_COLUMNS[sort], { ascending })
        .order("end_date", { ascending: true })
        .range(contractFrom, contractTo);
      if (error) throw error;
      /* The select string is built at runtime, so the client cannot type it. */
      contractRows = (data ?? []) as unknown as Row[];
      contractCount = count ?? 0;
    } else if (status !== "all") {
      contractCount = counts[status] ?? 0;
    }

    const rows = contractRows.map((row) => {
      const view = mapContract(row);
      const ents = ((row.amc_contract_entitlements as Row[]) ?? []).map((e) => ({
        entitlementType: e.entitlement_type as EntitlementType,
        includedQuantity: e.included_quantity === null ? null : Number(e.included_quantity),
        usedQuantity: Number(e.used_quantity ?? 0),
      }));
      const s = summarizeContract(ents);
      return {
        kind: "contract" as const,
        id: view.id,
        submissionId: view.submissionId,
        proposalNumber: view.proposalNumber,
        customerName: view.customerName,
        propertyLabel: view.propertyLabel,
        accountManagers: view.accountManagers.map((m) => m.name).filter(Boolean),
        startDate: view.startDate,
        endDate: view.endDate,
        displayStatus: view.displayStatus,
        expiryLabel: expiryLabel(view, today),
        grandTotal: view.grandTotal,
        daysRemaining: view.daysRemaining,
        coverage: {
          totalServices: s.totalServices,
          withRemaining: s.withRemaining,
          exhausted: s.exhausted,
          unlimited: s.unlimited,
          informational: s.informational,
        },
        canActivate: false,
      };
    });

    return NextResponse.json({
      ...base,
      rows: [...leadRows, ...rows],
      totalCount: lead.length + contractCount,
    });
  } catch (error) {
    console.error("AMC contracts list failed:", error);
    return NextResponse.json({ error: "Could not load AMC contracts" }, { status: 500 });
  }
}

const activateSchema = z
  .object({
    submissionId: z.string().uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date"),
    /** The user ticked "I have checked these details". */
    confirmed: z.literal(true, { message: "Confirm the details before activating." }),
  })
  .strict();

/** Activate AMC: turns a signed proposal into a contract. */
export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;

  const parsed = activateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { data: owner } = await gate.admin
    .from("amc_submissions")
    .select("owner_id")
    .eq("id", parsed.data.submissionId)
    .maybeSingle<{ owner_id: string }>();
  if (!owner) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  if (!canActivateContract(gate.actor, owner.owner_id)) {
    return NextResponse.json(
      { error: "Only the proposal's owner, an approver or AMC Operations (Create) can activate it." },
      { status: 403 },
    );
  }

  try {
    const { submissionId, startDate, endDate } = parsed.data;
    const contract = await activateContract(
      gate.admin,
      { submissionId, startDate, endDate },
      { id: gate.userId, label: gate.label },
    );
    /* Phase 7: the schedule and the initial payment gate, as in the lifecycle activation. */
    const gated = await gateAfterOneStepActivation(
      gate.admin,
      contract.id,
      { id: gate.userId, label: gate.label },
      await readAmcConfig(gate.admin),
    );
    return NextResponse.json({ contract: { ...contract, status: gated.status } }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not activate the contract");
  }
}
