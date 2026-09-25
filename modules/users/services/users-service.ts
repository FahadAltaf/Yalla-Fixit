import {
  DELETE_USER,
  GET_ASSIGNABLE_USERS,
  GET_USERS,
  GET_USERS_BY_EMAIL,
  GET_USERS_BY_ID,
  GET_USERS_COUNT,
  GET_USERS_PAGINATION,
  INSERT_USER,
  UPDATE_USER,
} from "./users-graphql";
import { executeGraphQLBackend } from "@/lib/graphql-server";
import { User } from "@/types/types";

/** Enough of a person to put them in a picker. */
export type AssignableUser = Pick<User, "id" | "full_name" | "email" | "is_active">;

/*
  The staff list is the same answer for every picker on a screen, so it is
  fetched once and shared rather than once per component.

  A job page could ask for it four times over -- the Setup tab, the round
  dialog, the visit dialog, the wizard -- each pulling every profile in
  full. `inFlight` collapses the calls a single page makes into one
  request; the short cache covers a second dialog opened a moment later.
  It is deliberately brief, so somebody added to the team appears in the
  dropdowns without a reload.
*/
const STAFF_TTL_MS = 60_000;
let staffCache: { at: number; users: AssignableUser[] } | null = null;
let staffInFlight: Promise<AssignableUser[]> | null = null;

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
   * Get all users, following the cursor page by page so nobody past the
   * GraphQL page size is left out (staff pickers read this).
   */
  getUsers: async () => {
    const users: User[] = [];
    let after: string | null = null;
    // A hard stop, so a server that never reports the last page cannot loop.
    for (let page = 0; page < 200; page += 1) {
      const response = await executeGraphQLBackend(GET_USERS, { first: 100, after });
      const collection = response.user_profileCollection;
      users.push(...collection.edges.map((edge: { node: User }) => edge.node));
      if (!collection.pageInfo?.hasNextPage || !collection.pageInfo.endCursor) break;
      after = collection.pageInfo.endCursor;
    }
    return users;
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
        receives_schedule_approval_email: data.receives_schedule_approval_email ?? false,
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
   * Everyone who can be assigned to a job, a round or a visit: id, name
   * and email, nothing else. Shared and briefly cached (see above).
   */
  getAssignableUsers: async (): Promise<AssignableUser[]> => {
    if (staffCache && Date.now() - staffCache.at < STAFF_TTL_MS) {
      return staffCache.users;
    }
    if (staffInFlight) return staffInFlight;

    staffInFlight = (async () => {
      const users: AssignableUser[] = [];
      let after: string | null = null;
      // A hard stop, so a server that never reports the last page cannot loop.
      for (let page = 0; page < 200; page += 1) {
        const response = await executeGraphQLBackend(GET_ASSIGNABLE_USERS, {
          first: 100,
          after,
        });
        const collection = response.user_profileCollection;
        users.push(
          ...collection.edges.map((edge: { node: AssignableUser }) => edge.node),
        );
        if (!collection.pageInfo?.hasNextPage || !collection.pageInfo.endCursor) break;
        after = collection.pageInfo.endCursor;
      }
      staffCache = { at: Date.now(), users };
      return users;
    })();

    try {
      return await staffInFlight;
    } catch (error) {
      // Never cached, so the next screen tries again rather than
      // inheriting a failure.
      staffCache = null;
      throw error;
    } finally {
      staffInFlight = null;
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
