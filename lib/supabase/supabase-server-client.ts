"use server";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

// ✅ NO NEXT_PUBLIC_ prefix - These are purely server-side variables
const supabaseUrl = process.env.SUPABASE_URL;

const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Validate that environment variables are set
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables: SUPABASE_URL or SUPABASE_ANON_KEY"
  );
}

export async function createClient(cookieStore: ReadonlyRequestCookies) {
  return createServerClient(
    supabaseUrl || "",
    supabaseAnonKey || "",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  );
}

// Optional: Create a helper to get client in API routes
export async function createServerClientForApi() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}