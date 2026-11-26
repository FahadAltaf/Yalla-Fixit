import type { AmcConfig, AmcConfigSection } from "@/lib/amc/config";
import type { AmcRoleTemplate } from "@/lib/amc/role-templates";
import type { AmcConfigHistoryItem } from "@/lib/server/amc/config";
import type { AmcJobRunSummary, AmcRunRecipient } from "@/lib/server/amc/jobs";
import type { InAppNotification } from "@/lib/server/amc/notifications";
import { amcRequest } from "@/lib/amc/http-cache";

/**
 * Browser calls for the AMC platform screens (Phase 1): configuration,
 * role templates, scheduled jobs and the notifications inbox.
 */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return amcRequest<T>(url, init);
}

export interface AmcConfigUser {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  /** What their role lets them be named for (23 Nov 2026). */
  can?: { amc: boolean; enquiries: boolean; siteVisits: boolean; approve: boolean; payments: boolean; visits: boolean; contracts: boolean; mobile: boolean };
}

export interface AmcConfigResponse {
  config: AmcConfig;
  defaults: AmcConfig;
  saved: AmcConfigSection[];
  invalid: AmcConfigSection[];
  migrated: boolean;
  canEdit: Record<AmcConfigSection, boolean>;
  history: AmcConfigHistoryItem[];
  users: AmcConfigUser[];
}

export interface AmcRoleTemplateStatus {
  key: string;
  name: string;
  description: string;
  grants: AmcRoleTemplate["grants"];
  exists: boolean;
  missing: number;
}

export interface AmcJobRun {
  id: string;
  trigger: "scheduled" | "manual";
  started_at: string;
  finished_at: string | null;
  status: "running" | "succeeded" | "partial" | "failed";
  summary: AmcJobRunSummary["jobs"];
}

export interface NotificationPage {
  notifications: InAppNotification[];
  unread: number;
  migrated: boolean;
}

export const amcPlatformService = {
  getConfig() {
    return request<AmcConfigResponse>("/api/amc-config");
  },
  saveConfigSection<K extends AmcConfigSection>(section: K, value: AmcConfig[K]) {
    return request<{ ok: true; changed: number }>("/api/amc-config", { method: "PUT", body: JSON.stringify({ section, value }) });
  },
  roleTemplates() {
    return request<{ templates: AmcRoleTemplateStatus[] }>("/api/amc-config/role-templates");
  },
  applyRoleTemplates() {
    return request<{ applied: Array<{ name: string; created: boolean; added: number }>; templates: AmcRoleTemplateStatus[] }>(
      "/api/amc-config/role-templates",
      { method: "POST" },
    );
  },
  /** Who one run told: by person, channel and outcome (26 Nov 2026). */
  runRecipients(runId: string) {
    return request<{ recipients: AmcRunRecipient[] }>(`/api/amc-jobs/run?runId=${encodeURIComponent(runId)}`);
  },
  jobs() {
    return request<{ jobs: Array<{ key: string; label: string }>; runs: AmcJobRun[] }>("/api/amc-jobs/run");
  },
  runJobs() {
    return request<AmcJobRunSummary>("/api/amc-jobs/run", { method: "POST" });
  },
  notifications(params: { limit?: number; offset?: number; unread?: boolean } = {}) {
    const q = new URLSearchParams();
    if (params.limit) q.set("limit", String(params.limit));
    if (params.offset) q.set("offset", String(params.offset));
    if (params.unread) q.set("unread", "1");
    return request<NotificationPage>(`/api/amc-notifications${q.size ? `?${q}` : ""}`);
  },
  markRead(input: { all: true } | { ids: string[] }) {
    return request<{ ok: true }>("/api/amc-notifications", { method: "POST", body: JSON.stringify(input) });
  },
};
