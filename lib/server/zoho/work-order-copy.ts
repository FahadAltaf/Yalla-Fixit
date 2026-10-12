// FR-15 (appointments): copying an appointment to a later day means a NEW
// work order in Zoho FSM, a copy of the lines the source appointment
// covered, with a new appointment on it. The team confirmed this is how they
// copy appointments by hand in FSM (duplicate the work order), and FSM has
// no clone for appointments.
//
// Two reads and one write live here:
//   quoteFsmWorkOrderCopy  the lines a source appointment covers and their
//                          price, shown to the person before they confirm
//   createFsmWorkOrderCopy POST /Work_Orders with those lines, then read the
//                          new record back for its name and line ids
//
// The create is sent WITHOUT retry: a timed-out POST may have succeeded, and
// a second one would make a duplicate work order. The caller saves the new
// id on the entry before creating the appointment, so a retry of the
// appointment never repeats the work order either.

import { resolveAppointmentState } from "@/lib/scheduling/appointment-status";
import { isLiveLineAssociation } from "./appointments";
import {
  fsmFail,
  fsmFetch,
  fsmGetRecord,
  fsmOk,
  fsmResultFromError,
  getFsmContext,
  type FsmResult,
} from "./fsm-client";

type Ref = { id: string; name?: string } | null | undefined;

// The tax on a line, as FSM returns it. On this org (UAE VAT edition) a
// create is refused with "Unable to Update Grand Total" unless each line
// carries its tax; the Tax map is copied as is (tested 9 Oct 2026).
type LineTax = {
  Tax_Id?: string | null;
  Tax_Name?: string | null;
  Tax_Percentage?: number | null;
} | null;

type FullLine = {
  id: string;
  Name?: string;
  Service?: Ref;
  Quantity?: number | null;
  Sequence?: number | null;
  Description?: string | null;
  List_Price?: number | null;
  Amount?: number | null;
  Line_Item_Amount?: number | null;
  Discount?: number | null;
  Discount_Type?: string | null;
  Status?: string | null;
  Tax?: LineTax;
};

function taxOf(tax: LineTax | undefined): Record<string, unknown> | null {
  if (!tax?.Tax_Id) return null;
  return { Tax_Id: tax.Tax_Id, Tax_Name: tax.Tax_Name ?? "", Tax_Percentage: num(tax.Tax_Percentage) };
}

type FullTask = {
  id: string;
  Name?: string;
  Service_Task?: Ref;
  ServiceTask_Name?: string | null;
  Sequence?: number | null;
  Service_Line_Item?: Ref;
};

type FullPart = {
  id: string;
  Name?: string;
  Part?: Ref;
  Quantity?: number | null;
  Sequence?: number | null;
  Description?: string | null;
  List_Price?: number | null;
  Amount?: number | null;
  Line_Item_Amount?: number | null;
  Service_Line_Item?: Ref;
  Tax?: LineTax;
};

type Axs = {
  Service_Line_Item?: Ref;
  Service_Appointment?: Ref;
  SLI_Status?: string | null;
  is_line_item_active?: boolean;
};

type WorkOrderFull = {
  id: string;
  Name?: string;
  Summary?: string | null;
  Type?: string | null;
  Status?: string | null;
  Priority?: string | null;
  Currency?: string | null;
  $currency_symbol?: string | null;
  Contact?: Ref;
  Company?: Ref;
  Territory?: Ref;
  Asset?: Ref;
  Service_Address?: Ref;
  Billing_Address?: Ref;
  // Phone is mandatory on this org's work order layout (tested 9 Oct 2026).
  Phone?: string | null;
  Mobile?: string | null;
  Email?: string | null;
  Place_of_Supply?: string | null;
  Service_Line_Items?: FullLine[];
  Service_Tasks_Line_Items?: FullTask[];
  Part_Line_Items?: FullPart[];
  Appointments_X_Services?: Axs[];
};

export type CopyQuoteLine = {
  id: string;
  code: string; // SVC-6042
  service: string | null;
  quantity: number;
  amount: number; // before tax
  lineAmount: number; // after tax, what the customer is charged
};

export type WorkOrderCopyQuote = {
  workOrderId: string;
  workOrderName: string | null;
  summary: string | null;
  currency: string;
  lines: CopyQuoteLine[];
  // The parts tied to those lines; they are copied and priced too (WO1928's
  // part was missing from the first quote in the 9 Oct 2026 test).
  parts: CopyQuoteLine[];
  // Sum of lineAmount (after tax) and of amount (before tax), lines and parts.
  total: number;
  subtotal: number;
  // Whether every quoted line is free of a live appointment, so a copy on
  // the SAME work order could be made (one day only).
  linesFree: boolean;
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// The service lines a given appointment covers on its work order, live or
// not (a cancelled appointment still lists its lines on the junction).
export function linesOfAppointment(wo: WorkOrderFull, appointmentId: string): string[] {
  const ids: string[] = [];
  for (const axs of wo.Appointments_X_Services ?? []) {
    if (axs.Service_Appointment?.id !== appointmentId) continue;
    const lineId = axs.Service_Line_Item?.id;
    if (lineId && !ids.includes(lineId)) ids.push(lineId);
  }
  return ids;
}

function quoteOf(wo: WorkOrderFull, lineIds: string[]): WorkOrderCopyQuote {
  const live = new Set<string>();
  for (const axs of wo.Appointments_X_Services ?? []) {
    const lineId = axs.Service_Line_Item?.id;
    if (lineId && isLiveLineAssociation(axs)) live.add(lineId);
  }
  const chosen = new Set(lineIds);
  const lines = (wo.Service_Line_Items ?? [])
    .filter((l) => chosen.has(l.id))
    .map((l) => ({
      id: l.id,
      code: l.Name ?? l.id,
      service: l.Service?.name ?? null,
      quantity: num(l.Quantity) || 1,
      amount: num(l.Amount),
      lineAmount: num(l.Line_Item_Amount) || num(l.Amount),
    }));
  const parts = (wo.Part_Line_Items ?? [])
    .filter((p) => p.Service_Line_Item?.id && chosen.has(p.Service_Line_Item.id) && p.Part?.id)
    .map((p) => ({
      id: p.id,
      code: p.Name ?? p.id,
      service: p.Part?.name ?? null,
      quantity: num(p.Quantity) || 1,
      amount: num(p.Amount),
      lineAmount: num(p.Line_Item_Amount) || num(p.Amount),
    }));
  const all = [...lines, ...parts];
  return {
    workOrderId: wo.id,
    workOrderName: wo.Name ?? null,
    summary: wo.Summary ?? null,
    currency: wo.Currency ?? wo.$currency_symbol ?? "AED",
    lines,
    parts,
    total: Math.round(all.reduce((s, l) => s + l.lineAmount, 0) * 100) / 100,
    subtotal: Math.round(all.reduce((s, l) => s + l.amount, 0) * 100) / 100,
    linesFree: lines.every((l) => !live.has(l.id)),
  };
}

// What a copy would contain and cost. `appointmentId` picks the lines of
// that appointment; `lineIds` (a pending appointment that was never created)
// names them directly. With neither, every line of the work order.
export async function quoteFsmWorkOrderCopy(input: {
  workOrderId: string;
  appointmentId?: string | null;
  lineIds?: string[] | null;
}): Promise<FsmResult> {
  if (!input.workOrderId) return fsmFail("Missing field: workOrderId", 400);
  try {
    const { token } = await getFsmContext();
    const res = await fsmGetRecord<WorkOrderFull>(token, "Work_Orders", input.workOrderId);
    if (!res.ok) return fsmFail("Failed to read the work order from Zoho FSM", 502, { details: res.json });
    const wo = res.record;
    if (!wo) return fsmFail("Work order not found in Zoho FSM", 404);

    let lineIds = input.lineIds?.filter(Boolean) ?? [];
    if (lineIds.length === 0 && input.appointmentId) lineIds = linesOfAppointment(wo, input.appointmentId);
    if (lineIds.length === 0) lineIds = (wo.Service_Line_Items ?? []).map((l) => l.id);
    const quote = quoteOf(wo, lineIds);
    if (quote.lines.length === 0) {
      return fsmFail("Could not find the service lines of this appointment on its work order in Zoho FSM", 409);
    }
    return fsmOk({ quote, status: wo.Status ?? null });
  } catch (error) {
    return fsmResultFromError(error, "zoho:quoteFsmWorkOrderCopy");
  }
}

export type WorkOrderCopyOptions = {
  // Send the source line's List_Price (and discount) instead of letting FSM
  // take the catalogue price: the team confirmed a copy repeats the price of
  // the original. FSM accepts List_Price on create (tested 9 Oct 2026).
  copyPrices?: boolean;
  // Copy the parts tied to the copied lines.
  copyParts?: boolean;
  // Copy the service tasks tied to the copied lines.
  copyTasks?: boolean;
  // Carry over Priority and Asset.
  copyExtras?: boolean;
};

const DEFAULT_OPTIONS: Required<WorkOrderCopyOptions> = {
  copyPrices: true,
  copyParts: true,
  copyTasks: true,
  copyExtras: true,
};

// The POST /Work_Orders body for a copy of `sourceLineIds` of `src`. Pure,
// so it can be tested without FSM. Returns `{ error }` when the source
// cannot be copied.
export function buildWorkOrderCopyRecord(
  src: WorkOrderFull,
  sourceLineIds: string[],
  dueDate: string | null,
  options: WorkOrderCopyOptions = {},
): { record: Record<string, unknown>; sourceLines: FullLine[] } | { error: string } {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chosen = new Set(sourceLineIds);
  const sourceLines = (src.Service_Line_Items ?? []).filter((l) => chosen.has(l.id));
  if (sourceLines.length === 0) {
    return { error: "None of the chosen service lines exist on the source work order any more" };
  }
  const missingService = sourceLines.find((l) => !l.Service?.id);
  if (missingService) {
    return { error: `Service line ${missingService.Name ?? missingService.id} has no service to copy` };
  }
  for (const field of ["Contact", "Service_Address", "Billing_Address"] as const) {
    if (!src[field]?.id) return { error: `The source work order has no ${field.replace("_", " ")} to copy` };
  }

  const tasksOf = (lineId: string) =>
    (src.Service_Tasks_Line_Items ?? [])
      .filter((t) => t.Service_Line_Item?.id === lineId && t.Service_Task?.id)
      .sort((a, b) => num(a.Sequence) - num(b.Sequence));
  const partsOf = (lineId: string) =>
    (src.Part_Line_Items ?? [])
      .filter((p) => p.Service_Line_Item?.id === lineId && p.Part?.id)
      .sort((a, b) => num(a.Sequence) - num(b.Sequence));

  const lineItems = sourceLines.map((l, i) => {
    const tasks = opts.copyTasks ? tasksOf(l.id) : [];
    const parts = opts.copyParts ? partsOf(l.id) : [];
    const lineTax = taxOf(l.Tax);
    return {
      Service: l.Service!.id,
      Quantity: num(l.Quantity) || 1,
      Sequence: i + 1,
      ...(lineTax ? { Tax: lineTax } : {}),
      ...(l.Description ? { Description: l.Description } : {}),
      ...(opts.copyPrices && typeof l.List_Price === "number" ? { List_Price: l.List_Price } : {}),
      ...(opts.copyPrices && num(l.Discount) > 0
        ? { Discount: l.Discount, ...(l.Discount_Type ? { Discount_Type: l.Discount_Type } : {}) }
        : {}),
      ...(tasks.length > 0
        ? {
            Service_Tasks_Line_Items: tasks.map((t, j) => ({
              Service_Task: t.Service_Task!.id,
              ServiceTask_Name: t.ServiceTask_Name ?? t.Service_Task!.name ?? t.Name ?? "Task",
              Sequence: j + 1,
            })),
          }
        : {}),
      ...(parts.length > 0
        ? {
            Part_Line_Items: parts.map((p, j) => ({
              Part: p.Part!.id,
              Quantity: num(p.Quantity) || 1,
              Sequence: j + 1,
              ...(taxOf(p.Tax) ? { Tax: taxOf(p.Tax) } : {}),
              ...(p.Description ? { Description: p.Description } : {}),
              ...(opts.copyPrices && typeof p.List_Price === "number" ? { List_Price: p.List_Price } : {}),
            })),
          }
        : {}),
    };
  });

  const record: Record<string, unknown> = {
    Summary: src.Summary || src.Name || "Work order",
    Type: src.Type || "Service",
    Contact: src.Contact!.id,
    Company: src.Company?.id ?? null,
    Service_Address: { id: src.Service_Address!.id },
    Billing_Address: { id: src.Billing_Address!.id },
    Service_Line_Items: lineItems,
    ...(src.Phone ? { Phone: src.Phone } : {}),
    ...(src.Mobile ? { Mobile: src.Mobile } : {}),
    ...(src.Email ? { Email: src.Email } : {}),
    ...(src.Place_of_Supply ? { Place_of_Supply: src.Place_of_Supply } : {}),
    ...(src.Territory?.id ? { Territory: src.Territory.id } : {}),
    ...(opts.copyExtras && src.Asset?.id ? { Asset: src.Asset.id } : {}),
    ...(opts.copyExtras && src.Priority ? { Priority: src.Priority } : {}),
    ...(dueDate ? { Due_Date: dueDate } : {}),
  };
  return { record, sourceLines };
}

export type CreateWorkOrderCopyInput = {
  sourceWorkOrderId: string;
  // The source lines to copy; their tasks and parts come with them.
  sourceLineIds: string[];
  dueDate?: string | null; // YYYY-MM-DD, the day the copy is for
  correlationId?: string;
  // The total (after tax) the person confirmed; a different figure now
  // refuses the create.
  expectedTotal?: number | null;
};

// A work order this copy may already have created: the outcome of an
// earlier POST was unknown (timeout, 5xx, a crash before the id was saved).
// FSM's list is newest first; the match is the same contact, summary and
// due date, created after the attempt started. Exactly one match is adopted;
// several leave the decision to a person.
export async function findRecentFsmWorkOrderCopy(input: {
  sourceWorkOrderId: string;
  dueDate?: string | null;
  createdAfter: string; // ISO instant
}): Promise<FsmResult> {
  try {
    const { token } = await getFsmContext();
    const srcRes = await fsmGetRecord<WorkOrderFull>(token, "Work_Orders", input.sourceWorkOrderId);
    if (!srcRes.ok || !srcRes.record) return fsmFail("Failed to read the source work order from Zoho FSM", 502);
    const src = srcRes.record;
    const after = new Date(input.createdAfter).getTime() - 2 * 60_000;
    type Row = {
      id: string;
      Name?: string;
      Summary?: string | null;
      Due_Date?: string | null;
      Created_Time?: string | null;
      Contact?: Ref;
      Status?: string | null;
    };
    const matches: Row[] = [];
    for (let page = 1; page <= 2; page += 1) {
      const res = await fsmFetch(token, `/Work_Orders?per_page=200&page=${page}`);
      if (!res.ok) return fsmFail("Failed to list recent work orders in Zoho FSM", 502, { details: res.json });
      const rows: Row[] = res.json?.data ?? [];
      let olderSeen = false;
      for (const w of rows) {
        const created = w.Created_Time ? new Date(w.Created_Time).getTime() : 0;
        if (created < after) {
          olderSeen = true;
          continue;
        }
        if (w.id === src.id) continue;
        if ((w.Contact?.id ?? null) !== (src.Contact?.id ?? null)) continue;
        if ((w.Summary ?? "") !== (src.Summary ?? "")) continue;
        if (input.dueDate && (w.Due_Date ?? null) !== input.dueDate) continue;
        matches.push(w);
      }
      if (olderSeen || !res.json?.info?.more_records) break;
    }
    return fsmOk({
      matches: matches.map((w) => ({ id: w.id, name: w.Name ?? null, status: w.Status ?? null, createdTime: w.Created_Time ?? null })),
    });
  } catch (error) {
    return fsmResultFromError(error, "zoho:findRecentFsmWorkOrderCopy");
  }
}

// Creates the new work order and returns its id, name and the mapping from
// each source line id to its new line id. The mapping comes from reading the
// new record back, matched by Sequence (the copy is sent with Sequence 1..n
// in source order), not from the create response.
export async function createFsmWorkOrderCopy(input: CreateWorkOrderCopyInput): Promise<FsmResult> {
  if (!input.sourceWorkOrderId) return fsmFail("Missing field: sourceWorkOrderId", 400);
  if (!input.sourceLineIds?.length) return fsmFail("Missing field: sourceLineIds", 400);

  try {
    const { token } = await getFsmContext();

    const srcRes = await fsmGetRecord<WorkOrderFull>(token, "Work_Orders", input.sourceWorkOrderId);
    if (!srcRes.ok) return fsmFail("Failed to read the source work order from Zoho FSM", 502, { details: srcRes.json });
    const src = srcRes.record;
    if (!src) return fsmFail("Source work order not found in Zoho FSM", 404);
    if (resolveAppointmentState(src.Status) === "cancelled") {
      return fsmFail(`${src.Name ?? "The source work order"} is cancelled in Zoho FSM`, 409);
    }

    // The price the person confirmed must still be the price: the source may
    // have been repriced in FSM since the copy was made.
    if (typeof input.expectedTotal === "number") {
      const now = quoteOf(src, input.sourceLineIds);
      if (Math.abs(now.total - input.expectedTotal) > 0.009) {
        return fsmFail(
          `The price of ${src.Name ?? "the source work order"} changed since the copy was confirmed (${now.currency} ${input.expectedTotal.toFixed(2)} then, ${now.currency} ${now.total.toFixed(2)} now). Remove the copy and copy it again.`,
          409,
          { expectedTotal: input.expectedTotal, currentTotal: now.total },
        );
      }
    }

    const built = buildWorkOrderCopyRecord(src, input.sourceLineIds, input.dueDate ?? null);
    if ("error" in built) return fsmFail(built.error, 409);
    const { record, sourceLines } = built;

    const createRes = await fsmFetch(
      token,
      "/Work_Orders",
      { method: "POST", body: JSON.stringify({ data: [record] }) },
      { retry: false },
    );
    if (!createRes.ok) {
      console.error("[zoho:createFsmWorkOrderCopy] FSM create failed:", createRes.json);
      const timedOut = createRes.status === 408;
      return fsmFail(
        timedOut
          ? "Zoho FSM did not answer the work order creation in time. Check FSM for a new work order before retrying."
          : "Zoho FSM rejected the work order creation",
        502,
        { details: createRes.json, correlationId: input.correlationId, timedOut, fsmStatus: createRes.status },
      );
    }

    // The create response is an object ({ Work_Orders: [{ id }], ... }) on
    // some tenants and an array on others; accept both.
    const data = createRes.json?.data;
    const createdId: string | undefined =
      data?.Work_Orders?.[0]?.id ?? (Array.isArray(data) ? data[0]?.details?.id ?? data[0]?.id : undefined);
    if (!createdId) {
      console.error("[zoho:createFsmWorkOrderCopy] no id in create response:", createRes.json);
      return fsmFail("Zoho FSM answered the work order creation without an id. The next retry checks FSM before creating one.", 502, {
        details: createRes.json,
        timedOut: true,
      });
    }

    const readBack = await fsmGetRecord<WorkOrderFull>(token, "Work_Orders", createdId);
    const made = readBack.ok ? readBack.record : undefined;
    const lineIdMap: Record<string, string> = {};
    if (made) {
      const bySequence = new Map((made.Service_Line_Items ?? []).map((l) => [num(l.Sequence), l.id] as const));
      sourceLines.forEach((l, i) => {
        const id = bySequence.get(i + 1);
        if (id) lineIdMap[l.id] = id;
      });
    }
    const mapped = Object.keys(lineIdMap).length;
    return fsmOk({
      workOrderId: createdId,
      workOrderName: made?.Name ?? null,
      lineIdMap,
      // The caller treats an incomplete map as a failure AFTER saving the id.
      mappedAllLines: mapped === sourceLines.length,
      currency: made?.Currency ?? null,
      correlationId: input.correlationId,
      raw: createRes.json,
    });
  } catch (error) {
    return fsmResultFromError(error, "zoho:createFsmWorkOrderCopy");
  }
}
