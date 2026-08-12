import { executeRESTBackend } from "@/lib/rest-server";
import { TechnicianTag } from "@/types/types";

export const tagsService = {
  listTags: async (): Promise<TechnicianTag[]> => {
    return executeRESTBackend<TechnicianTag[]>("/api/scheduling/tags", { method: "GET" });
  },

  listAssignmentsByTechnician: async (): Promise<Record<string, TechnicianTag[]>> => {
    return executeRESTBackend<Record<string, TechnicianTag[]>>("/api/scheduling/tag-assignments", {
      method: "GET",
    });
  },

  createTag: async (name: string): Promise<TechnicianTag> => {
    return executeRESTBackend<TechnicianTag>("/api/scheduling/tags", {
      method: "POST",
      body: { name },
    });
  },

  updateTag: async (id: string, name: string): Promise<TechnicianTag> => {
    return executeRESTBackend<TechnicianTag>("/api/scheduling/tags", {
      method: "PUT",
      body: { id, name },
    });
  },

  deleteTag: async (id: string): Promise<{ success: boolean; affectedTechnicianCount: number }> => {
    return executeRESTBackend<{ success: boolean; affectedTechnicianCount: number }>(
      "/api/scheduling/tags",
      { method: "DELETE", params: { id } },
    );
  },

  assignTag: async (technicianFsmId: string, tagId: string): Promise<{ success: boolean }> => {
    return executeRESTBackend<{ success: boolean }>("/api/scheduling/tag-assignments", {
      method: "POST",
      body: { technicianFsmId, tagId },
    });
  },

  removeTag: async (technicianFsmId: string, tagId: string): Promise<{ success: boolean }> => {
    return executeRESTBackend<{ success: boolean }>("/api/scheduling/tag-assignments", {
      method: "DELETE",
      params: { technicianFsmId, tagId },
    });
  },
};
