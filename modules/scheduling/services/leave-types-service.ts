import { executeRESTBackend } from "@/lib/rest-server";
import type { LeaveType } from "@/types/types";

// FR-21: the managed leave-type list behind the Add Leave dropdown.
export const leaveTypesService = {
  list: async (): Promise<LeaveType[]> =>
    executeRESTBackend<LeaveType[]>("/api/scheduling/leave-types", { method: "GET" }),
  create: async (name: string): Promise<LeaveType> =>
    executeRESTBackend<LeaveType>("/api/scheduling/leave-types", { method: "POST", body: { name } }),
  update: async (id: string, name: string): Promise<LeaveType> =>
    executeRESTBackend<LeaveType>("/api/scheduling/leave-types", { method: "PUT", body: { id, name } }),
  remove: async (id: string): Promise<{ success: boolean; recordCount: number }> =>
    executeRESTBackend<{ success: boolean; recordCount: number }>("/api/scheduling/leave-types", {
      method: "DELETE",
      params: { id },
    }),
};
