import { amcRest as executeRESTBackend } from "@/lib/amc/http-cache";

/*
  Through the AMC cache (13 Nov 2026): reads asked for at once share one
  request and are answered from memory for a moment. A save drops every
  cached record (a site visit's proposal included), and a settings save the
  stable lists too, but a draft save no longer empties the rarely-changing
  ones (rules, rate card, technicians).
*/

import type {
  AmcSettings,
  AmcSettingsOverrides,
} from "@/components/dashboard/extensions/amc/amc-settings";

export interface AmcSettingsHistoryItem {
  id: number;
  actorLabel: string | null;
  changedKeys: string[];
  /** What changed, in words (UAT AMC-097). Empty on changes saved before it was recorded. */
  changes: string[];
  createdAt: string;
}

export interface AmcSettingsResponse {
  /** What documents will render with: defaults plus edits. */
  settings: AmcSettings;
  /** What has actually been edited, so the page can mark a field as
   *  customised rather than still on the shipped default. */
  overrides: AmcSettingsOverrides;
  changedKeys?: string[];
  /** What the save changed, in words (UAT AMC-097). */
  changes?: string[];
  /** FR6.5 — the first page of settings changes, newest first. Empty for non-admins. */
  history?: AmcSettingsHistoryItem[];
  /** How many changes there are in all. */
  historyTotal?: number;
  /** FR5.3 — everyone with AMC access, for choosing approvers. Admins only. */
  amcUsers?: { email: string; name: string; isAdmin: boolean }[];
}

export const amcSettingsService = {
  getSettings: async (): Promise<AmcSettingsResponse> =>
    executeRESTBackend<AmcSettingsResponse>("/api/amc-settings", {
      method: "GET",
    }),

  /** FR6.5 — one page of the change history, newest first. */
  getHistory: async (page: number, pageSize: number) =>
    executeRESTBackend<{ items: AmcSettingsHistoryItem[]; total: number }>(
      `/api/amc-settings/history?page=${page}&pageSize=${pageSize}`,
      { method: "GET" },
    ),

  /** The AMC approvers (all levels), by email, saved alone (AMC configuration → Named people). */
  saveApprovers: async (approvers: string[]) =>
    executeRESTBackend<{ approvers: string[] }>("/api/amc-settings/approvers", {
      method: "PUT",
      body: { approvers },
    }),

  saveSettings: async (
    overrides: AmcSettingsOverrides,
  ): Promise<AmcSettingsResponse> =>
    executeRESTBackend<AmcSettingsResponse>("/api/amc-settings", {
      method: "PUT",
      body: overrides as unknown as Record<string, unknown>,
    }),
};
