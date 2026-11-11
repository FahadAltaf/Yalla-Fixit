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
import { amcRequest } from "@/lib/amc/http-cache";

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
  return amcRequest<T>(url, init);
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
