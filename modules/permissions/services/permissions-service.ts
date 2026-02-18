import { executeRESTBackend } from "@/lib/rest-server";
import { RoleAccess, ResourceType, ActionType } from "@/types/types";
import { v4 as uuidv4 } from "uuid";

export const permissionsService = {
  /**
   * Get all permissions for a role
   */
  getPermissionsByRole: async (roleId: string) => {
    const response = await executeRESTBackend<RoleAccess[]>("/api/role-access", {
      method: "GET",
      params: {
        operation: "getByRole",
        roleId,
      },
    });

    return response;
  },

  /**
   * Create a permission
   */
  createPermission: async (data: {
    role_id: string;
    resource: ResourceType;
    action: ActionType;
    enabled?: boolean;
    record_access?: string;
  }) => {
    const permissionData = {
      id: uuidv4(),
      role_id: data.role_id,
      resource: data.resource,
      action: data.action,
      enabled: data.enabled ?? true,
      record_access: data.record_access || "All Records",
    };

    const response = await executeRESTBackend("/api/role-access", {
      method: "POST",
      body: {
        operation: "create",
        data: permissionData,
      },
    });

    return response;
  },

  /**
   * Bulk create permissions
   */
  bulkCreatePermissions: async (
    roleId: string,
    permissions: Array<{
      resource: ResourceType;
      action: ActionType;
      enabled?: boolean;
      record_access?: string;
    }>
  ) => {
    const permissionsData = permissions.map((perm) => ({
      id: uuidv4(),
      role_id: roleId,
      resource: perm.resource,
      action: perm.action,
      enabled: perm.enabled ?? true,
      record_access: perm.record_access || "All Records",
    }));

    const response = await executeRESTBackend("/api/role-access", {
      method: "POST",
      body: {
        operation: "bulkCreate",
        data: permissionsData,
      },
    });

    return response;
  },

  /**
   * Delete all permissions for a role
   */
  deletePermissionsByRole: async (roleId: string) => {
    await executeRESTBackend("/api/role-access", {
      method: "DELETE",
      params: {
        roleId,
      },
    });
  },

  /**
   * Delete a single permission
   */
  deletePermission: async (id: string) => {
    await executeRESTBackend("/api/role-access", {
      method: "DELETE",
      params: {
        id,
      },
    });
  },
};

