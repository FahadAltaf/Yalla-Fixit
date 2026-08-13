import { executeRESTBackend } from "@/lib/rest-server";
import { LeaveRecord, LeaveStatus } from "@/types/types";

export interface LeaveCreateInput {
  technicianFsmId: string;
  leaveType: string;
  startAt: string;
  endAt: string;
  notes?: string | null;
}

export interface LeaveUpdateInput {
  id: string;
  leaveType?: string;
  startAt?: string;
  endAt?: string;
  notes?: string | null;
  status?: LeaveStatus;
}

export interface AssignmentConflict {
  schedule_entry_id: string;
  schedule_entries: {
    title: string | null;
    start_at: string;
    end_at: string;
    fsm_work_order_id: string | null;
    fsm_appointment_id: string | null;
  };
}

export interface LeaveFilters {
  technicianFsmId?: string;
  status?: LeaveStatus | "all";
  search?: string;
}

export const leaveService = {
  listLeave: async (filters: LeaveFilters = {}): Promise<LeaveRecord[]> => {
    const params: Record<string, string> = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== "all") params[key] = String(value);
    });
    return executeRESTBackend<LeaveRecord[]>("/api/scheduling/leave", {
      method: "GET",
      params,
    });
  },

  createLeave: async (
    data: LeaveCreateInput,
  ): Promise<{ record: LeaveRecord; conflicts: AssignmentConflict[] }> => {
    return executeRESTBackend("/api/scheduling/leave", {
      method: "POST",
      body: data as unknown as Record<string, unknown>,
    });
  },

  updateLeave: async (
    data: LeaveUpdateInput,
  ): Promise<{ record: LeaveRecord; conflicts: AssignmentConflict[] }> => {
    return executeRESTBackend("/api/scheduling/leave", {
      method: "PUT",
      body: data as unknown as Record<string, unknown>,
    });
  },

  cancelLeave: async (id: string): Promise<{ record: LeaveRecord; conflicts: AssignmentConflict[] }> => {
    return executeRESTBackend("/api/scheduling/leave", {
      method: "PUT",
      body: { id, status: "cancelled" },
    });
  },
};
