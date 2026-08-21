// Zoho FSM Work Order reads for the scheduler.
//
// Ported from the zoho-fsm-work-order-search / zoho-fsm-work-order-lines
// Edge Functions (FRD PLAN-003/004, O-4).

import {
  fsmFail,
  fsmFetch,
  fsmGetRecord,
  fsmOk,
  fsmResultFromError,
  getFsmContext,
  type FsmResult,
} from "./fsm-client";

// FSM's /Work_Orders/search endpoint only reliably filters by Name and Type
// on this org -- Contact/Company/Address/date searches return nothing there.
// So a work order NUMBER uses the fast native Name search, while the other
// filters scan a batch of recent work orders in-memory.
const RECENT_PAGES = 4; // up to 4 * 200 = 800 most-recent work orders
const PER_PAGE = 200;
const MAX_MATCHES = 50;

export type WorkOrderSearchInput = {
  workOrderName?: string;
  contact?: string;
  company?: string;
  address?: string;
  dateFrom?: string; // YYYY-MM-DD (Due_Date on/after)
  dateTo?: string; // YYYY-MM-DD (Due_Date on/before)
};

type WorkOrder = {
  id: string;
  Name?: string;
  Summary?: string;
  Status?: string;
  Type?: string;
  Due_Date?: string | null;
  Created_Time?: string | null;
  Contact?: { name?: string } | null;
  Company?: { name?: string } | null;
  Service_Address?: Record<string, string | null> | null;
};

type ServiceLineItem = {
  id: string;
  Name?: string;
  Description?: string | null;
  Status?: string;
  Service?: { name?: string } | null;
};

type ServiceTaskLineItem = { id: string; Name?: string; Status?: string };

type AxsItem = {
  Service_Line_Item?: { id: string } | null;
  Service_Appointment?: { id: string; name?: string } | null;
};

type WorkOrderDetail = {
  id: string;
  Name?: string;
  Type?: string;
  Service_Line_Items?: ServiceLineItem[];
  Service_Tasks_Line_Items?: ServiceTaskLineItem[];
  Appointments_X_Services?: AxsItem[];
};

function addressText(addr?: Record<string, string | null> | null): string {
  if (!addr) return "";
  return Object.entries(addr)
    .filter(([k]) => /street|city|state|country|zip|address/i.test(k))
    .map(([, v]) => v ?? "")
    .filter(Boolean)
    .join(" ");
}

function shape(w: WorkOrder) {
  return {
    id: w.id,
    name: w.Name ?? null,
    summary: w.Summary ?? null,
    status: w.Status ?? null,
    type: w.Type ?? null,
    dueDate: w.Due_Date ?? null,
    contactName: w.Contact?.name ?? null,
    companyName: w.Company?.name ?? null,
    address: addressText(w.Service_Address) || null,
  };
}

export async function searchFsmWorkOrders(input: WorkOrderSearchInput): Promise<FsmResult> {
  const hasFilter =
    input.workOrderName || input.contact || input.company || input.address || input.dateFrom || input.dateTo;
  if (!hasFilter) return fsmFail("Provide at least one search filter", 400);

  try {
    const { token } = await getFsmContext();

    // Fast path: a work order number uses FSM's native Name search.
    if (input.workOrderName) {
      const query = new URLSearchParams({
        api_name: "Name",
        value: input.workOrderName.trim(),
        comparator: "contains",
        per_page: "25",
      });
      const res = await fsmFetch(token, `/Work_Orders/search?${query}`);
      const results: WorkOrder[] = res.json?.data ?? [];
      return fsmOk({ results: results.map(shape), scope: "by-number" });
    }

    // Otherwise filter a batch of recent work orders in-memory. This means
    // those searches look within the most recent work orders (bounded below),
    // which suits day-to-day scheduling.
    const contact = input.contact?.trim().toLowerCase();
    const company = input.company?.trim().toLowerCase();
    const address = input.address?.trim().toLowerCase();
    const fromMs = input.dateFrom ? new Date(`${input.dateFrom}T00:00:00`).getTime() : null;
    const toMs = input.dateTo ? new Date(`${input.dateTo}T23:59:59`).getTime() : null;

    const matches: WorkOrder[] = [];
    for (let page = 1; page <= RECENT_PAGES; page += 1) {
      const res = await fsmFetch(token, `/Work_Orders?per_page=${PER_PAGE}&page=${page}`);
      if (!res.ok) break;
      const rows: WorkOrder[] = res.json?.data ?? [];

      for (const w of rows) {
        if (contact && !(w.Contact?.name ?? "").toLowerCase().includes(contact)) continue;
        if (company && !(w.Company?.name ?? "").toLowerCase().includes(company)) continue;
        if (address && !addressText(w.Service_Address).toLowerCase().includes(address)) continue;
        if (fromMs || toMs) {
          const due = w.Due_Date ? new Date(w.Due_Date).getTime() : null;
          if (due === null) continue;
          if (fromMs && due < fromMs) continue;
          if (toMs && due > toMs) continue;
        }
        matches.push(w);
        if (matches.length >= MAX_MATCHES) break;
      }
      if (matches.length >= MAX_MATCHES) break;
      if (!res.json?.info?.more_records) break;
    }

    return fsmOk({ results: matches.map(shape), scope: "recent" });
  } catch (error) {
    return fsmResultFromError(error, "zoho:searchFsmWorkOrders");
  }
}

// The service line items (and any service task line items) of a work order,
// so the scheduler can choose which line(s) a NEW appointment will cover
// (FSM's create requires the $Service_Line_Items ids). Lines already attached
// to an appointment are flagged so they can't be double-scheduled.
export async function getFsmWorkOrderLines(workOrderId: string): Promise<FsmResult> {
  if (!workOrderId) return fsmFail("Missing field: workOrderId", 400);

  try {
    const { token } = await getFsmContext();

    const res = await fsmGetRecord<WorkOrderDetail>(token, "Work_Orders", workOrderId);
    if (!res.ok) {
      console.error("[zoho:getFsmWorkOrderLines] WO fetch failed:", res.json);
      return fsmFail("Failed to read work order from Zoho FSM", 502);
    }
    const wo = res.record;
    if (!wo) return fsmFail("Work order not found in Zoho FSM", 404);

    // Which service lines already sit on an appointment.
    const scheduledLineIds = new Set<string>();
    for (const axs of wo.Appointments_X_Services ?? []) {
      if (axs.Service_Line_Item?.id && axs.Service_Appointment?.id) {
        scheduledLineIds.add(axs.Service_Line_Item.id);
      }
    }

    return fsmOk({
      workOrderId: wo.id,
      workOrderName: wo.Name ?? null,
      workOrderType: wo.Type ?? null,
      serviceLineItems: (wo.Service_Line_Items ?? []).map((line) => ({
        id: line.id,
        name: line.Name ?? line.id,
        serviceName: line.Service?.name ?? null,
        description: line.Description ?? null,
        status: line.Status ?? null,
        scheduled: scheduledLineIds.has(line.id),
      })),
      serviceTaskLineItems: (wo.Service_Tasks_Line_Items ?? []).map((t) => ({
        id: t.id,
        name: t.Name ?? t.id,
        status: t.Status ?? null,
      })),
    });
  } catch (error) {
    return fsmResultFromError(error, "zoho:getFsmWorkOrderLines");
  }
}
