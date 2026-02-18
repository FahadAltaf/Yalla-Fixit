import {
  GET_ALL_ROLES,
  GET_ROLE_BY_ID,
  GET_ROLES_WITH_ACCESS,
  GET_ROLES_PAGINATED,
  SEARCH_ROLES,
  GET_ROLE_BY_NAME,
  CREATE_ROLE,
  UPDATE_ROLE,
  DELETE_ROLE,
  GET_ROLE_ACCESS,
  CREATE_ROLE_ACCESS,
  DELETE_ROLE_ACCESS,
  DELETE_ROLE_ACCESS_BY_ROLE,
} from "./roles-graphql";
import { executeGraphQLBackend } from "@/lib/graphql-server";
import { v4 as uuidv4 } from "uuid";
import { Role, RoleAccess } from "@/types/types";

// Type for role with access permissions
interface RoleWithAccess extends Role {
  role_access: Array<{
    id: string;
    resource: string;
    action: string;
  }>;
}

export const rolesService = {
  /**
   * Get all roles
   */
  getAllRoles: async () => {
    try {
      const data = await executeGraphQLBackend(GET_ALL_ROLES);
      return data.rolesCollection.edges.map(
        (edge: { node: Role }) => edge.node
      );
    } catch (error) {
      console.error("Error fetching roles:", error);
      return [];
    }
  },

  /**
   * Get a role by ID
   */
  getRoleById: async (id: string): Promise<Role | null> => {
    try {
      const data = await executeGraphQLBackend<{ roles_by_pk: Role }>(GET_ROLE_BY_ID, {
        id,
      });
      return data.roles_by_pk;
    } catch (error) {
      console.error(`Error fetching role with ID ${id}:`, error);
      return null;
    }
  },

  /**
   * Get roles with their access permissions
   */
  getRolesWithAccess: async (): Promise<RoleWithAccess[]> => {
    try {
      const data = await executeGraphQLBackend(GET_ROLES_WITH_ACCESS);

      // Transform the data to match the expected format
      const roles = data.rolesCollection.edges.map(
        (edge: {
          node: {
            role_accessCollection: { edges: Array<{ node: RoleAccess }> };
          };
        }) => {
          const node = edge.node;
          return {
            ...node,
            role_access:
              node?.role_accessCollection?.edges.map(
                (accessEdge: { node: RoleAccess }) => accessEdge.node
              ) || [],
          };
        }
      );

      return roles;
    } catch (error) {
      console.error("Error fetching roles with access:", error);
      return [];
    }
  },

  /**
   * Get paginated roles with search
   */
  getPaginatedRoles: async (
    search = "",
    page = 0,
    pageSize = 10
  ): Promise<{ roles: Role[]; total: number }> => {
    try {
      const offset = page * pageSize;
      const searchPattern = `%${search}%`;

      const data = await executeGraphQLBackend(GET_ROLES_PAGINATED, {
        limit: pageSize,
        offset: offset,
      });

      return {
        roles: data.rolesCollection.edges.map(
          (edge: { node: Role }) => edge.node
        ),
        total: data.rolesCollection.edges.length,
      };
    } catch (error) {
      console.error("Error fetching paginated roles:", error);
      return { roles: [], total: 0 };
    }
  },

  /**
   * Search roles by name
   */
  searchRoles: async (searchTerm: string): Promise<Role[]> => {
    try {
      // Add wildcard for partial matches
      const formattedSearchTerm = `%${searchTerm}%`;

      const data = await executeGraphQLBackend(SEARCH_ROLES, {
        searchTerm: formattedSearchTerm,
      });

      return data.rolesCollection || [];
    } catch (error) {
      console.error(`Error searching roles with term "${searchTerm}":`, error);
      return [];
    }
  },

  getRoleByName: async (roleName: string = "user"): Promise<string> => {
    try {
      const roleData = await executeGraphQLBackend(GET_ROLE_BY_NAME, {
        name: roleName,
      });

      const role = roleData?.rolesCollection.edges[0].node;
      if (!role.id) {
        console.error("Error fetching user role: Role not found");
      }

      return role?.id || "e1b0d2c1-79b0-48b4-94fd-60a7bbf2b7c4"; // Fallback to hardcoded user role ID
    } catch (error) {
      console.error(`Error searching roles with term:`, error);
      return "";
    }
  },

  /**
   * Create a new role
   */
  createRole: async (
    name: string,
    description?: string
  ): Promise<Role | null> => {
    try {
      const data = await executeGraphQLBackend(CREATE_ROLE, {
        objects: [
          {
            name,
            description: description || null,
          },
        ],
      });
      if (data.insertIntorolesCollection.errors) {
        throw new Error(data.insertIntorolesCollection.errors[0].message);
      }

      return data.insertIntorolesCollection.records[0];
    } catch (error) {
      console.error("Error creating role:", error);
      return null;
    }
  },

  /**
   * Update an existing role
   */
  updateRole: async (
    id: string,
    name: string,
    description?: string
  ): Promise<Role | null> => {
    try {
      const data = await executeGraphQLBackend(UPDATE_ROLE, {
        id,
        name,
        description,
      });

      return data.updaterolesCollection.records[0];
    } catch (error) {
      console.error(`Error updating role with ID ${id}:`, error);
      return null;
    }
  },

  /**
   * Delete a role
   */
  deleteRole: async (id: string): Promise<boolean> => {
    try {
      const result = await executeGraphQLBackend(DELETE_ROLE, { id });
      return result.deleteFromrolesCollection.affectedCount > 0;
    } catch (error) {
      console.error(`Error deleting role with ID ${id}:`, error);
      return false;
    }
  },

  /**
   * Get role access permissions for a role
   */
  getRoleAccess: async (roleId: string): Promise<RoleAccess[]> => {
    try {
      const data = await executeGraphQLBackend(GET_ROLE_ACCESS, {
        filter: { ...(roleId ? { role_id: { eq: roleId } } : {}) },
      });
      return data.role_accessCollection.edges.map(
        (edge: { node: RoleAccess }) => edge.node
      );
    } catch (error) {
      console.error(`Error fetching role access for role ID ${roleId}:`, error);
      return [];
    }
  },

  /**
   * Create a new role access permission
   */
  createRoleAccess: async (
    roleId: string,
    resource: string,
    action: string
  ): Promise<RoleAccess | null> => {
    try {
      const data = await executeGraphQLBackend(CREATE_ROLE_ACCESS, {
        objects: [
          {
            role_id: roleId,
            resource,
            action,
          },
        ],
      });
      if (data.insertIntorole_accessCollection.errors) {
        throw new Error(data.insertIntorole_accessCollection.errors[0].message);
      }
      return data.insertIntorole_accessCollection.records[0];
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Error creating role access:", error.message);
      } else {
        console.error("Error creating role access:", error);
      }
      throw error;
    }
  },

  /**
   * Delete a role access permission
   */
  deleteRoleAccess: async (id: string): Promise<boolean> => {
    try {
      const result = await executeGraphQLBackend(DELETE_ROLE_ACCESS, { id });
      return result.deleteFromrole_accessCollection.affectedCount > 0;
    } catch (error) {
      console.error(`Error deleting role access with ID ${id}:`, error);
      return false;
    }
  },

  /**
   * Delete all role access permissions for a role
   */
  deleteRoleAccessByRole: async (roleId: string): Promise<boolean> => {
    try {
      const result = await executeGraphQLBackend(DELETE_ROLE_ACCESS_BY_ROLE, {
        roleId,
      });
      return result.deleteFromrole_accessCollection.affectedCount > 0;
    } catch (error) {
      console.error(`Error deleting role access for role ID ${roleId}:`, error);
      return false;
    }
  },
};
