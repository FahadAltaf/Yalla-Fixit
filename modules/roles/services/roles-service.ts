import { executeRESTBackend } from "@/lib/rest-server";
import { Role, RoleAccess } from "@/types/types";

// Type for role with access permissions
interface RoleWithAccess extends Role {
  role_access: Array<{
    id: string;
    resource: string;
    action: string;
  }>;
}

/*
  Every call goes to /api/roles or /api/role-access, which check the
  signed-in user (Roles / Permissions rights; admins always pass) and write
  with the service role. These used to be pg_graphql requests with the
  public anon key: anyone could create a role, rename one, or grant a role
  any permission.
*/
export const rolesService = {
  /**
   * Get all roles
   */
  getAllRoles: async (): Promise<Role[]> => {
    try {
      const { roles } = await executeRESTBackend<{ roles: Role[] }>("/api/roles");
      return roles;
    } catch (error) {
      console.error("Error fetching roles:", error);
      return [];
    }
  },

  /**
   * Get a role by ID
   */
  getRoleById: async (id: string): Promise<Role | null> => {
    const roles = await rolesService.getAllRoles();
    return roles.find((r) => r.id === id) ?? null;
  },

  /**
   * Get roles with their access permissions (Permissions: View)
   */
  getRolesWithAccess: async (): Promise<RoleWithAccess[]> => {
    try {
      const { roles } = await executeRESTBackend<{ roles: RoleWithAccess[] }>("/api/roles", { params: { op: "withAccess" } });
      return roles;
    } catch (error) {
      console.error("Error fetching roles with access:", error);
      return [];
    }
  },

  /**
   * Get paginated roles with search
   */
  getPaginatedRoles: async (search = "", page = 0, pageSize = 10): Promise<{ roles: Role[]; total: number }> => {
    const all = await rolesService.searchRoles(search);
    return { roles: all.slice(page * pageSize, page * pageSize + pageSize), total: all.length };
  },

  /**
   * Search roles by name
   */
  searchRoles: async (searchTerm: string): Promise<Role[]> => {
    const term = searchTerm.replace(/%/g, "").trim().toLowerCase();
    const roles = await rolesService.getAllRoles();
    return term ? roles.filter((r) => r.name?.toLowerCase().includes(term)) : roles;
  },

  /**
   * Create a new role (Roles: Create)
   */
  createRole: async (name: string, description?: string): Promise<Role | null> => {
    try {
      const { role } = await executeRESTBackend<{ role: Role }>("/api/roles", {
        method: "POST",
        body: { name, description: description || null },
      });
      return role;
    } catch (error) {
      console.error("Error creating role:", error);
      return null;
    }
  },

  /**
   * Update an existing role (Roles: Edit)
   */
  updateRole: async (id: string, name: string, description?: string): Promise<Role | null> => {
    try {
      const { role } = await executeRESTBackend<{ role: Role }>("/api/roles", {
        method: "PATCH",
        params: { id },
        body: { name, description: description ?? null },
      });
      return role;
    } catch (error) {
      console.error(`Error updating role with ID ${id}:`, error);
      return null;
    }
  },

  /**
   * Delete a role (Roles: Delete). The admin role, or a role still held by
   * users, is refused.
   */
  deleteRole: async (id: string): Promise<boolean> => {
    try {
      await executeRESTBackend("/api/roles", { method: "DELETE", params: { id } });
      return true;
    } catch (error) {
      console.error(`Error deleting role with ID ${id}:`, error);
      return false;
    }
  },

  /**
   * Get role access permissions for a role (Permissions: View)
   */
  getRoleAccess: async (roleId: string): Promise<RoleAccess[]> => {
    try {
      const { data } = await executeRESTBackend<{ data: RoleAccess[] }>("/api/role-access", {
        params: { operation: "getByRole", roleId },
      });
      return data;
    } catch (error) {
      console.error(`Error fetching role access for role ID ${roleId}:`, error);
      return [];
    }
  },

  /**
   * Create a new role access permission (Permissions: Create)
   */
  createRoleAccess: async (roleId: string, resource: string, action: string): Promise<RoleAccess | null> => {
    const { data } = await executeRESTBackend<{ data: RoleAccess }>("/api/role-access", {
      method: "POST",
      body: { operation: "create", data: { role_id: roleId, resource, action, enabled: true } },
    });
    return data;
  },

  /**
   * Delete a role access permission (Permissions: Edit + Delete)
   */
  deleteRoleAccess: async (id: string): Promise<boolean> => {
    try {
      await executeRESTBackend("/api/role-access", { method: "DELETE", params: { id } });
      return true;
    } catch (error) {
      console.error(`Error deleting role access with ID ${id}:`, error);
      return false;
    }
  },

  /**
   * Delete all role access permissions for a role (Permissions: Edit + Delete)
   */
  deleteRoleAccessByRole: async (roleId: string): Promise<boolean> => {
    try {
      await executeRESTBackend("/api/role-access", { method: "DELETE", params: { roleId } });
      return true;
    } catch (error) {
      console.error(`Error deleting role access for role ID ${roleId}:`, error);
      return false;
    }
  },
};
