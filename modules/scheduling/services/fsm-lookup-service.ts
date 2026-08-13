import { executeRESTBackend } from "@/lib/rest-server";

export interface FsmWorkOrderAppointmentRef {
  id: string;
  name: string;
}

export interface FsmWorkOrderLookup {
  id: string;
  name: string;
  status: string;
  summary: string;
  contact_name: string;
  address: string;
  type: string;
  total_appointments: number;
  appointments: FsmWorkOrderAppointmentRef[];
}

export interface FsmAppointmentLookup {
  id: string;
  name: string;
  address: string;
  contact_id: string;
  contact_name: string;
  summary: string;
  type: string;
  status: string;
}

export interface FsmServiceLineItem {
  id: string;
  name: string;
  serviceName: string | null;
  description: string | null;
  status: string | null;
  scheduled: boolean;
}

export interface FsmServiceTaskLineItem {
  id: string;
  name: string;
  status: string | null;
}

export interface FsmWorkOrderLines {
  workOrderId: string;
  workOrderName: string | null;
  workOrderType: string | null;
  serviceLineItems: FsmServiceLineItem[];
  serviceTaskLineItems: FsmServiceTaskLineItem[];
}

export interface FsmWorkOrderSearchResult {
  id: string;
  name: string | null;
  summary: string | null;
  status: string | null;
  type: string | null;
  dueDate: string | null;
  contactName: string | null;
  companyName: string | null;
  address: string | null;
}

export interface WorkOrderSearchInput {
  workOrderName?: string;
  contact?: string;
  company?: string;
  address?: string;
  dateFrom?: string;
  dateTo?: string;
}

// PLAN-003/PLAN-004: the underlying zoho-fsm-work-orders/zoho-fsm-appointments
// Edge Functions do an exact-ish name lookup and return a single record
// (they were built for attachment bulk-download, not multi-result search).
// This is a real limitation of the current FSM integration -- a scheduler
// must know the WO/AP number rather than free-searching by client/address.
export const fsmLookupService = {
  findWorkOrder: async (name: string): Promise<FsmWorkOrderLookup | null> => {
    try {
      return await executeRESTBackend<FsmWorkOrderLookup>("/api/work-orders", {
        method: "POST",
        body: { name, comparator: "contains" },
      });
    } catch {
      return null;
    }
  },

  findAppointment: async (name: string): Promise<FsmAppointmentLookup | null> => {
    try {
      return await executeRESTBackend<FsmAppointmentLookup>("/api/appointments", {
        method: "POST",
        body: { name },
      });
    } catch {
      return null;
    }
  },

  // The service/task lines of a work order, so the team can choose which the
  // new appointment covers (Zoho FSM $Service_Line_Items).
  getWorkOrderLines: async (workOrderId: string): Promise<FsmWorkOrderLines | null> => {
    try {
      return await executeRESTBackend<FsmWorkOrderLines>("/api/scheduling/work-order-lines", {
        method: "POST",
        body: { workOrderId },
      });
    } catch {
      return null;
    }
  },

  // O-4: multi-result search by number, client, company, address or due date.
  searchWorkOrders: async (
    input: WorkOrderSearchInput,
  ): Promise<{ results: FsmWorkOrderSearchResult[]; scope: string }> => {
    return executeRESTBackend<{ results: FsmWorkOrderSearchResult[]; scope: string }>(
      "/api/scheduling/work-order-search",
      { method: "POST", body: input as unknown as Record<string, unknown> },
    );
  },
};
