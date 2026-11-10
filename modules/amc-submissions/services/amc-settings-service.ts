import { executeRESTBackend } from "@/lib/rest-server";

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

  saveSettings: async (
    overrides: AmcSettingsOverrides,
  ): Promise<AmcSettingsResponse> =>
    executeRESTBackend<AmcSettingsResponse>("/api/amc-settings", {
      method: "PUT",
      body: overrides as unknown as Record<string, unknown>,
    }),
};
