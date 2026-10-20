import { executeRESTBackend } from "@/lib/rest-server";
import type { ReportingSettings, ReportingSettingsOverrides } from "@/lib/reporting/settings";
import type { InAppNotification } from "@/lib/server/notifications/inbox";
import type { ReportingSettingsHistoryEntry } from "@/lib/server/reporting/audit";
import type { FsmResourceStatus } from "@/lib/server/finance/fsm-sync/status";
import type { PickableUser } from "@/lib/server/people/pickable-users";

export type ReportingSettingsResponse = {
  settings: ReportingSettings;
  defaults: ReportingSettings;
  overrides: ReportingSettingsOverrides;
  history: ReportingSettingsHistoryEntry[];
  users: PickableUser[];
  canEdit: boolean;
};

export const reportingService = {
  getSettings: () => executeRESTBackend<ReportingSettingsResponse>("/api/reporting-settings"),

  saveSettings: (overrides: ReportingSettingsOverrides) =>
    executeRESTBackend<{
      settings: ReportingSettings;
      overrides: ReportingSettingsOverrides;
      changedKeys: string[];
      history: ReportingSettingsHistoryEntry[];
    }>("/api/reporting-settings", { method: "PUT", body: overrides as Record<string, unknown> }),

  fsmStatus: () =>
    executeRESTBackend<{ resources: FsmResourceStatus[] }>("/api/finance/fsm-sync/status"),
};

export const notificationsService = {
  list: (options: { limit: number; offset?: number; unread?: boolean }) =>
    executeRESTBackend<{ notifications: InAppNotification[]; unread: number }>("/api/notifications", {
      params: {
        limit: options.limit,
        offset: options.offset ?? 0,
        ...(options.unread ? { unread: "1" } : {}),
      },
    }),

  markRead: (which: { all: true } | { ids: string[] }) =>
    executeRESTBackend<{ ok: true }>("/api/notifications", { method: "POST", body: which }),
};
