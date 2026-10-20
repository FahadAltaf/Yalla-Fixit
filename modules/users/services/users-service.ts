import { executeRESTBackend } from "@/lib/rest-server";
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

/*
  Every call goes to /api/users, which checks the signed-in user and
  writes with the service role. These used to be pg_graphql requests with
  the public anon key, so any visitor could read or rewrite any profile,
  their own role included.
*/
export const usersService = {
  /**
   * Insert a user profile (Users: Create).
   */
  insertUser: async (data: User) => {
    const { user } = await executeRESTBackend<{ user: User }>("/api/users", {
      method: "POST",
      body: {
        id: data.id,
        email: data.email,
        role_id: data.role_id,
        first_name: data.first_name || null,
        last_name: data.last_name || null,
        profile_image: data.profile_image || null,
        full_name: data.full_name || null,
      },
    });
    return user;
  },
  /**
   * Create a user - wrapper for insertUser
   */
  createUser: async (data: User) => {
    return await usersService.insertUser(data);
  },
  /**
   * Every colleague, for pickers. Directory fields only, unless the caller
   * manages users.
   */
  getUsers: async () => {
    const { users } = await executeRESTBackend<{ users: User[] }>("/api/users", { params: { op: "all" } });
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
    return executeRESTBackend<{ users: User[]; totalCount: number }>("/api/users", {
      params: {
        op: "page",
        /* The screen sends an ilike pattern ("%term%"); the server wants the term. */
        search: search.replace(/%/g, ""),
        limit,
        page: offset,
        sortBy: sorting?.sortBy ?? "created_at",
        sortOrder: sorting?.sortOrder ?? "desc",
      },
    });
  },
  /**
   * Update a user. Your own name and photo; anything else needs Users: Edit.
   */
  updateUser: async (data: User): Promise<void> => {
    await executeRESTBackend("/api/users", {
      method: "PATCH",
      body: {
        id: data.id,
        first_name: data.first_name,
        last_name: data.last_name,
        role_id: data.role_id,
        full_name: data.full_name,
        profile_image: data.profile_image,
        is_active: data.is_active,
        receives_schedule_approval_email: data.receives_schedule_approval_email ?? false,
      },
    });
  },
  /**
   * Delete a user profile (Users: Delete). A user who owns records that
   * must be kept is refused: deactivate them instead.
   */
  deleteUser: async (id: string): Promise<void> => {
    await executeRESTBackend("/api/users", { method: "DELETE", params: { id } });
  },
  /**
   * Everyone who can be assigned to a job, a round or a visit: id, name
   * and email, nothing else. Shared and briefly cached (see above).
   *
   * Only people with access to Snagging (the admin role, or a role with
   * Snagging's View permission), and only the active ones. This read every
   * profile in the company, so the pickers offered people who could not
   * open the module: assigned as an inspector, the job never reached their
   * phone. The server decides who qualifies (/api/snagging/staff).
   */
  getAssignableUsers: async (): Promise<AssignableUser[]> => {
    if (staffCache && Date.now() - staffCache.at < STAFF_TTL_MS) {
      return staffCache.users;
    }
    if (staffInFlight) return staffInFlight;

    staffInFlight = (async () => {
      const users = await executeRESTBackend<AssignableUser[]>("/api/snagging/staff", {
        method: "GET",
      });
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
   * Get a user by id (yourself, or Users: View).
   */
  getUserById: async (id: string) => {
    const { user } = await executeRESTBackend<{ user: User }>("/api/users", { params: { op: "byId", id } });
    return user;
  },
};
