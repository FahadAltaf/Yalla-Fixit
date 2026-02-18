import {
  DELETE_USER,
  GET_USERS,
  GET_USERS_BY_EMAIL,
  GET_USERS_BY_ID,
  GET_USERS_COUNT,
  GET_USERS_PAGINATION,
  INSERT_USER,
  UPDATE_USER,
} from "./users-graphql";
import { executeGraphQLBackend } from "@/lib/graphql-server";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { deleteAuthUserById } from "@/modules/auth/auth-actions";
import { User } from "@/types/types";

export const usersService = {
  /**
   * Insert a user
   */
  insertUser: async (data: User) => {
    const response = await executeGraphQLBackend(INSERT_USER, {
      objects: [
        {
          id: data.id,
          email: data.email,
          role_id: data.role_id,
          first_name: data.first_name || null,
          last_name: data.last_name || null,
          is_active: true,
          profile_image: data.profile_image || null,
          full_name: data.full_name || null,
        },
      ],
    });
    if (response.errors) {
      return response.errors[0].message;
    }
    return response.insertIntouser_profileCollection.records[0];
  },
  getUserByEmail: async (filter: { email: { ilike: string } }) => {
    const response = await executeGraphQLBackend(GET_USERS_BY_EMAIL, {
      filter,
    });
    return response.user_profileCollection.edges[0]?.node as User | null;
  },
  /**
   * Create a user - wrapper for insertUser
   */
  createUser: async (data: User) => {
    return await usersService.insertUser(data);
  },
  /**
   * Get all users
   */
  getUsers: async () => {
    const response = await executeGraphQLBackend(GET_USERS);
    return response.user_profileCollection.edges.map(
      (edge: { node: User }) => edge.node
    );
  },
  getUsersPagination: async (
    search: string,
    limit: number,
    offset: number,
    sorting?: {
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    }
  ) => {
    // Create a filter object based on role
    const filter: {
      or: Array<
        { email: { ilike: string } } | { full_name: { ilike: string } }
      >;
    } = {
      or: [{ email: { ilike: search } }, { full_name: { ilike: search } }],
    };

    const response = await executeGraphQLBackend(GET_USERS_PAGINATION, {
      filter,
      limit,
      offset: offset * limit,
      sorting:
        Object.keys(sorting || {}).length > 0
          ? {
              [sorting?.sortBy || "created_at"]:
                sorting?.sortOrder === "asc" ? "AscNullsLast" : "DescNullsLast",
            }
          : { created_at: "DescNullsLast" },
    });

    const countResponse = await executeGraphQLBackend(GET_USERS_COUNT, {
      filter,
    });

    return {
      users: response.user_profileCollection.edges.map(
        (edge: { node: User }) => edge.node
      ),
      totalCount: countResponse.user_profileCollection.edges.length,
    };
  },
  /**
   * Update a user
   */
  updateUser: async (data: User): Promise<void> => {
    try {
      const response = await executeGraphQLBackend(UPDATE_USER, {
        id: data.id,
        first_name: data.first_name,
        last_name: data.last_name,
        role_id: data.role_id,
        full_name: data.full_name,
        profile_image: data.profile_image,
        is_active: data.is_active,
      });

      if (response.errors) {
        throw new Error(response.errors[0].message);
      }
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : "Failed to update user"
      );
    }
  },
  /**
   * Delete a user from both GraphQL database and Supabase Auth
   */
  deleteUser: async (id: string): Promise<void> => {
    try {
      // Delete user from GraphQL database
     const result = await executeGraphQLBackend(DELETE_USER, { id });
     if (result.errors) {
      throw new Error(result.errors[0].message);
     }
   
    } catch (error) {
      console.error("Error deleting user:", error);
      throw error;
    }
  },
  /**
   * Get a user by id
   */
  getUserById: async (id: string) => {
    try {
      const response = await executeGraphQLBackend(GET_USERS_BY_ID, { id });
      return response.user_profileCollection.edges[0].node;
    } catch (error) {
      console.error("Error getting user by id:", error);
      throw error;
    }
  },
};
