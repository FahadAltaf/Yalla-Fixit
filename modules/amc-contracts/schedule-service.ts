import type { z } from "zod";

import type { ppmActionSchema } from "@/lib/amc/ppm";
import type {
  ContractPpm,
  SchedulableLine,
  ScheduleRules,
  VisitChangeRecord,
  VisitLineRecord,
  VisitRecord,
} from "@/lib/server/amc/ppm";

/**
 * Browser calls for a contract's PPM schedule (Phase 8), through
 * /api/amc-contracts/<id>/schedule. The server checks who may change it;
 * `permissions.canEdit` only decides what is offered.
 */

export type { ContractPpm, SchedulableLine, ScheduleRules, VisitChangeRecord, VisitLineRecord, VisitRecord };

/** What a screen sends: the schema's input, before its trims. */
export type ScheduleActionInput = z.input<typeof ppmActionSchema>;

export type ContractScheduleResponse = ContractPpm & { permissions: { canEdit: boolean } };

export interface ScheduleActionResult {
  ok: true;
  /** Visits made (generate) or groups clubbed (club_overlapping). */
  changed?: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong");
  return body as T;
}

export const scheduleService = {
  contractSchedule(contractId: string) {
    return request<ContractScheduleResponse>(`/api/amc-contracts/${contractId}/schedule`);
  },
  scheduleAction(contractId: string, action: ScheduleActionInput) {
    return request<ScheduleActionResult>(`/api/amc-contracts/${contractId}/schedule`, {
      method: "POST",
      body: JSON.stringify(action),
    });
  },
};
