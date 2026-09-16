import { executeRESTBackend } from "@/lib/rest-server";

import type {
  AmcSettings,
  AmcSettingsOverrides,
} from "@/components/dashboard/extensions/amc/amc-settings";

export interface AmcSettingsResponse {
  /** What documents will render with: defaults plus edits. */
  settings: AmcSettings;
  /** What has actually been edited, so the page can mark a field as
   *  customised rather than still on the shipped default. */
  overrides: AmcSettingsOverrides;
  changedKeys?: string[];
}

export const amcSettingsService = {
  getSettings: async (): Promise<AmcSettingsResponse> =>
    executeRESTBackend<AmcSettingsResponse>("/api/amc-settings", {
      method: "GET",
    }),

  saveSettings: async (
    overrides: AmcSettingsOverrides,
  ): Promise<AmcSettingsResponse> =>
    executeRESTBackend<AmcSettingsResponse>("/api/amc-settings", {
      method: "PUT",
      body: overrides as unknown as Record<string, unknown>,
    }),
};
