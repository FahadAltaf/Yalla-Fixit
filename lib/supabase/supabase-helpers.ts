"use server";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

// ✅ Get environment variables (no NEXT_PUBLIC_ prefix!)
const getSupabaseConfig = () => {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase environment variables. Make sure SUPABASE_URL and SUPABASE_ANON_KEY are set."
    );
  }

  return { url, anonKey, serviceRoleKey };
};

/**
 * Creates a Supabase client for Server Components and Server Actions
 * Automatically manages cookies for session persistence
 */
export async function createServerClientWithCookies() {
  const { url, anonKey } = getSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
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
          // Ignore errors from Server Components
        }
      },
    },
  });
}

/**
 * Creates an admin Supabase client for admin operations
 * Uses service role key for elevated permissions
 * Should NEVER be exposed to client-side code
 */
export async function createAdminServerClient() {
  const { url, serviceRoleKey } = getSupabaseConfig();

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for admin operations"
    );
  }

  const { createClient } = await import("@supabase/supabase-js");

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}

/**
 * Creates a Supabase client with custom cookie store
 * Useful for API routes that manage their own cookie handling
 */
export async function createServerClientWithCustomCookies(
  cookieStore: ReadonlyRequestCookies
) {
  const { url, anonKey } = getSupabaseConfig();

  return createServerClient(url, anonKey, {
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
          // Ignore errors
        }
      },
    },
  });
}

/**
 * Get app URL from environment variables
 * Used for redirects and email links
 */
export async function getAppUrl() {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  return appUrl;
}

// Type export for Supabase client
export type { Session } from "@supabase/supabase-js";