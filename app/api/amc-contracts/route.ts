import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  DEFAULT_EXPIRING_WINDOW_DAYS,
  daysRemaining,
  todayInDubai,
} from "@/lib/amc/contracts";
import { grandTotalFromFinal } from "@/lib/amc/pricing";
import { canManage, requireContractAccess } from "@/lib/server/amc/contract-access";
import {
  CONTRACT_COLUMNS,
  ContractError,
  activateContract,
  isMissingTable,
  mapContract,
} from "@/lib/server/amc/contracts";
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

type Row = Record<string, unknown>;

function accountManagerOf(row: Row, key: "account_managers" | "document_options"): string {
  const list =
    key === "account_managers"
      ? row.account_managers
      : (row.document_options as Row | null)?.accountManagers;
  const first = (Array.isArray(list) ? list : []).find((m) => (m as Row)?.name) as Row | undefined;
  return first ? String(first.name) : "";
}

export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { admin, userId, canApprove } = gate;

  const params = req.nextUrl.searchParams;
  const statusParam = params.get("status") ?? "all";
  const status: ListStatus = (LIST_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as ListStatus)
    : "all";
  const term = likeTerm(params.get("search"));
  const { page, pageSize, from, to } = pageParams(params, { defaultSize: 10 });

  const today = todayInDubai();
  /* Last day of the "expiring" window (same default as the detail page). */
  const windowEnd = shiftDays(today, DEFAULT_EXPIRING_WINDOW_DAYS);

  /* Contracts query with the visibility rule and a derived-status filter. */
  const contractQuery = (forStatus: ListStatus, head = false) => {
    let q = admin
      .from("amc_contracts")
      .select(
        head
          ? "id, amc_submissions!inner(owner_id)"
          : `${CONTRACT_COLUMNS}, amc_submissions!inner(owner_id)`,
        head ? { count: "exact", head: true } : { count: "exact" },
      );
    if (!canApprove) q = q.eq("amc_submissions.owner_id", userId);
    if (term) {
      q = q.or(
        `customer_name.ilike.${term},proposal_number.ilike.${term},property_label.ilike.${term},customer_ref.ilike.${term}`,
      );
    }
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

  /* Signed proposals that have no contract yet. Few at any time, so they
     are filtered here rather than with an anti-join. */
  const loadPending = async () => {
    let q = admin
      .from("amc_submissions")
      .select("id, owner_id, proposal_number, customer, property, document_options, final_price, signed_at, amc_contracts(id)")
      .eq("status", "signed")
      .order("signed_at", { ascending: false })
      .limit(500);
    if (!canApprove) q = q.eq("owner_id", userId);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []).filter((row) => {
      const linked = (row as Row).amc_contracts;
      return !(Array.isArray(linked) ? linked.length : linked);
    }) as Row[];
    const needle = term ? term.slice(1, -1).toLowerCase() : "";
    return rows
      .filter((row) => {
        if (!needle) return true;
        const c = (row.customer ?? {}) as Row;
        const p = (row.property ?? {}) as Row;
        return [c.customerName, c.customerId, row.proposal_number, p.propertyAddress, p.propertyDetail]
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
          accountManager: accountManagerOf(row, "document_options"),
          startDate: start,
          endDate: end,
          displayStatus: "pending_activation" as const,
          grandTotal: grandTotalFromFinal(Number(row.final_price ?? 0)),
          daysRemaining: end ? daysRemaining(end, today) : null,
          canActivate: canManage(gate, (row.owner_id as string | null) ?? null),
        };
      });
  };

  try {
    const countStatuses: ListStatus[] = ["not_started", "active", "expiring", "expired", "cancelled"];
    const [pending, ...countResults] = await Promise.all([
      loadPending(),
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
    const counts: Record<string, number> = {
      all: (countResults[0].count ?? 0) + pending.length,
      pending_activation: pending.length,
    };
    countStatuses.forEach((s, i) => {
      counts[s] = countResults[i + 1].count ?? 0;
    });

    if (status === "pending_activation") {
      return NextResponse.json({
        rows: pending.slice(from, to + 1),
        totalCount: pending.length,
        counts,
        canApprove,
        page,
        pageSize,
      });
    }

    const { data, error, count } = await contractQuery(status)
      .order("end_date", { ascending: true })
      .range(from, to);
    if (error) throw error;
    /* The select string is built at runtime, so the client cannot type it. */
    const rows = ((data ?? []) as unknown as Row[]).map((row) => {
      const view = mapContract(row);
      return {
        kind: "contract" as const,
        id: view.id,
        submissionId: view.submissionId,
        proposalNumber: view.proposalNumber,
        customerName: view.customerName,
        propertyLabel: view.propertyLabel,
        accountManager: accountManagerOf(row, "account_managers"),
        startDate: view.startDate,
        endDate: view.endDate,
        displayStatus: view.displayStatus,
        grandTotal: view.grandTotal,
        daysRemaining: view.daysRemaining,
        canActivate: false,
      };
    });
    /* "All" also lists what is waiting to be activated, first. */
    const combined = status === "all" && page === 0 ? [...pending, ...rows] : rows;
    return NextResponse.json({
      rows: combined,
      totalCount: (count ?? 0) + (status === "all" ? pending.length : 0),
      counts,
      canApprove,
      page,
      pageSize,
    });
  } catch (error) {
    console.error("AMC contracts list failed:", error);
    return NextResponse.json({ error: "Could not load AMC contracts" }, { status: 500 });
  }
}

function shiftDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const activateSchema = z
  .object({
    submissionId: z.string().uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date"),
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
  if (!canManage(gate, owner.owner_id)) {
    return NextResponse.json(
      { error: "Only the proposal's owner or an approver can activate it." },
      { status: 403 },
    );
  }

  try {
    const contract = await activateContract(gate.admin, parsed.data, {
      id: gate.userId,
      label: gate.label,
    });
    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    if (error instanceof ContractError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("AMC activation failed:", error);
    return NextResponse.json({ error: "Could not activate the contract" }, { status: 500 });
  }
}
