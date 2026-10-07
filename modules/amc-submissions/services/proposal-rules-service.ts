import type { AmcConfig } from "@/lib/amc/config";
import type { RateCard } from "@/lib/amc/rate-card";
import type { VersionReason } from "@/lib/amc/proposal-rules";
import type { ProposalVersion } from "@/lib/server/amc/proposal-versions";
import type { RateCardVersion } from "@/lib/server/amc/rate-card";

/** Browser calls for Phase 4: the rate card, the wizard's rules, versions, proposals from enquiries. */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong");
  return body as T;
}

export type { ProposalVersion, RateCardVersion };

export interface ProposalRules {
  today: string;
  rateCard: { id: string; versionNo: number; effectiveFrom: string; card: RateCard } | null;
  payments: AmcConfig["payments"];
  approvals: Pick<
    AmcConfig["approvals"],
    "level1Name" | "level2Name" | "level3Name" | "discountLevel1AbovePercent" | "discountLevel2AbovePercent" | "discountLevel3AbovePercent"
  >;
  validityDays: number;
}

export interface RateCardResponse {
  migrated: boolean;
  today: string;
  versions: RateCardVersion[];
  inForceId: string | null;
  services: Array<{ id: string; label: string; frequencyType: string }>;
  canEdit: boolean;
}

export const proposalRulesService = {
  rules() {
    return request<ProposalRules>("/api/amc-proposal-rules");
  },
  rateCard() {
    return request<RateCardResponse>("/api/amc-rate-card");
  },
  publishRateCard(input: { card: RateCard; effectiveFrom: string; reason: string }) {
    return request<{ version: RateCardVersion }>("/api/amc-rate-card", { method: "POST", body: JSON.stringify(input) });
  },
  versions(submissionId: string) {
    return request<{ versions: ProposalVersion[]; migrated: boolean }>(`/api/amc-submissions/versions?id=${encodeURIComponent(submissionId)}`);
  },
  revise(input: { id: string; reason: VersionReason; summary: string }) {
    return request<{ versionNo: number; lockedVersionNo: number }>("/api/amc-submissions/versions", { method: "POST", body: JSON.stringify(input) });
  },
  versionUrl(submissionId: string, versionNo: number) {
    return request<{ url: string }>(`/api/amc-submissions/versions/file?id=${encodeURIComponent(submissionId)}&version=${versionNo}`);
  },
  proposalFromEnquiry(enquiryId: string) {
    return request<{ submissionId: string; proposalNumber: string; source: "site_visit" | "scope" | "none"; warnings: string[] }>(
      `/api/amc-enquiries/${enquiryId}/proposal`,
      { method: "POST" },
    );
  },
};
