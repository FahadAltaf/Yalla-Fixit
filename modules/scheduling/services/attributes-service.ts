import { executeRESTBackend } from "@/lib/rest-server";
import type { TechnicianRole, TechnicianServiceType } from "@/types/types";

// Managed Role and Service Type lists (extensible from the Technicians window).
export const rolesService = {
  list: async (): Promise<TechnicianRole[]> =>
    executeRESTBackend<TechnicianRole[]>("/api/scheduling/roles", { method: "GET" }),
  create: async (name: string): Promise<TechnicianRole> =>
    executeRESTBackend<TechnicianRole>("/api/scheduling/roles", { method: "POST", body: { name } }),
  update: async (id: string, name: string): Promise<TechnicianRole> =>
    executeRESTBackend<TechnicianRole>("/api/scheduling/roles", { method: "PUT", body: { id, name } }),
  remove: async (id: string): Promise<{ success: boolean }> =>
    executeRESTBackend<{ success: boolean }>("/api/scheduling/roles", { method: "DELETE", params: { id } }),
};

export const serviceTypesService = {
  list: async (): Promise<TechnicianServiceType[]> =>
    executeRESTBackend<TechnicianServiceType[]>("/api/scheduling/service-types", { method: "GET" }),
  create: async (name: string): Promise<TechnicianServiceType> =>
    executeRESTBackend<TechnicianServiceType>("/api/scheduling/service-types", { method: "POST", body: { name } }),
  update: async (id: string, name: string): Promise<TechnicianServiceType> =>
    executeRESTBackend<TechnicianServiceType>("/api/scheduling/service-types", { method: "PUT", body: { id, name } }),
  remove: async (id: string): Promise<{ success: boolean }> =>
    executeRESTBackend<{ success: boolean }>("/api/scheduling/service-types", { method: "DELETE", params: { id } }),
};
