import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType, type User } from "@/types/types";

/**
 * What every report shares (BRD 5.2 B5 "common to every report"; DEV-455):
 * role-based access, saved filters per user, and the access log (who
 * opened or exported what, BRD 6.9 note). Tables in schema `reports`
 * (migration 20261022100000).
 */

/** Each report, the permission that opens it, and its key in `reports`. */
export const REPORTS = {
  quotations: { resource: ResourceType.REPORTS_QUOTATIONS, title: "Quotation summary" },
  exceptions: { resource: ResourceType.REPORTS_EXCEPTIONS, title: "Exception reports" },
} as const;

export type ReportKey = keyof typeof REPORTS;

export const reportKeySchema = z.enum(Object.keys(REPORTS) as [ReportKey, ...ReportKey[]]);

export function reportAccess(user: User, report: ReportKey) {
  const resource = REPORTS[report].resource;
  return {
    view: hasResourceAction(user, resource, ActionType.VIEW),
    export: hasResourceAction(user, resource, ActionType.EXPORT),
  };
}

// ---------------------------------------------------------------------
// Access log
// ---------------------------------------------------------------------

export type AccessEntry = {
  report: ReportKey;
  action: "view" | "export";
  user: { id: string; label: string };
  filters?: Record<string, unknown>;
  rowCount?: number;
  format?: "csv" | "xlsx";
};

/** Never thrown: a lost log row must not stop someone reading a report. */
export async function logReportAccess(admin: SupabaseClient, entry: AccessEntry): Promise<void> {
  try {
    const { error } = await admin
      .schema("reports")
      .from("access_log")
      .insert({
        report_key: entry.report,
        action: entry.action,
        user_id: entry.user.id,
        user_label: entry.user.label,
        filters: entry.filters ?? null,
        row_count: entry.rowCount ?? null,
        format: entry.format ?? null,
      });
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error(`[reports:${entry.report}] access log failed:`, error);
  }
}

// ---------------------------------------------------------------------
// Saved filters
// ---------------------------------------------------------------------

/** Filter values are short strings, numbers or booleans: nothing else is kept. */
export const filtersSchema = z
  .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/), z.union([z.string().max(200), z.number(), z.boolean()]))
  .refine((f) => Object.keys(f).length <= 30, "Too many filters");

export type SavedFilter = { id: string; name: string; filters: Record<string, unknown>; updatedAt: string };

export const MAX_SAVED_PER_REPORT = 20;

export async function readSavedFilters(
  admin: SupabaseClient,
  userId: string,
  report: ReportKey,
): Promise<{ lastUsed: Record<string, unknown> | null; saved: SavedFilter[] }> {
  const { data, error } = await admin
    .schema("reports")
    .from("saved_filters")
    .select("id, kind, name, filters, updated_at")
    .eq("user_id", userId)
    .eq("report_key", report)
    .order("name");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const last = rows.find((r) => r.kind === "last_used");
  return {
    lastUsed: (last?.filters as Record<string, unknown> | undefined) ?? null,
    saved: rows
      .filter((r) => r.kind === "saved")
      .map((r) => ({
        id: String(r.id),
        name: String(r.name),
        filters: r.filters as Record<string, unknown>,
        updatedAt: String(r.updated_at),
      })),
  };
}

export async function rememberLastUsed(
  admin: SupabaseClient,
  userId: string,
  report: ReportKey,
  filters: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .schema("reports")
    .from("saved_filters")
    .update({ filters, updated_at: now })
    .eq("user_id", userId)
    .eq("report_key", report)
    .eq("kind", "last_used")
    .select("id");
  if (error) throw new Error(error.message);
  if (data && data.length) return;
  const { error: insertError } = await admin
    .schema("reports")
    .from("saved_filters")
    .insert({ user_id: userId, report_key: report, kind: "last_used", filters });
  /* Two tabs saving at once: the other one won, which is as good. */
  if (insertError && insertError.code !== "23505") throw new Error(insertError.message);
}

export class SavedFilterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Saves under a name; the same name again replaces that one. */
export async function saveNamedFilter(
  admin: SupabaseClient,
  userId: string,
  report: ReportKey,
  name: string,
  filters: Record<string, unknown>,
): Promise<SavedFilter> {
  const existing = await readSavedFilters(admin, userId, report);
  const same = existing.saved.find((s) => s.name.toLowerCase() === name.toLowerCase());
  const now = new Date().toISOString();
  if (same) {
    const { error } = await admin
      .schema("reports")
      .from("saved_filters")
      .update({ name, filters, updated_at: now })
      .eq("id", same.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { id: same.id, name, filters, updatedAt: now };
  }
  if (existing.saved.length >= MAX_SAVED_PER_REPORT) {
    throw new SavedFilterError(`You can keep up to ${MAX_SAVED_PER_REPORT} saved filters per report.`, 400);
  }
  const { data, error } = await admin
    .schema("reports")
    .from("saved_filters")
    .insert({ user_id: userId, report_key: report, kind: "saved", name, filters })
    .select("id, updated_at")
    .single();
  if (error) {
    if (error.code === "23505") throw new SavedFilterError("A saved filter with that name already exists.", 409);
    throw new Error(error.message);
  }
  return { id: String(data.id), name, filters, updatedAt: String(data.updated_at) };
}

/** Only the owner's own saved filter; "last used" is never deleted here. */
export async function deleteNamedFilter(admin: SupabaseClient, userId: string, id: string): Promise<boolean> {
  const { data, error } = await admin
    .schema("reports")
    .from("saved_filters")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .eq("kind", "saved")
    .select("id");
  if (error) throw new Error(error.message);
  return Boolean(data && data.length);
}
