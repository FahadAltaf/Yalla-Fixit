import type { z } from "zod";

import type { boardActionSchema, technicianProfileSchema, visitActionSchema } from "@/lib/amc/visits";
import type { BoardData, BoardVisit, TechnicianRecord, VisitDetail, VisitSuggestion } from "@/lib/server/amc/visits";

/**
 * Browser calls for AMC visits on the board (Phase 9): the technicians'
 * skills, one visit (confirmation, access, crew), suggestions for a slot,
 * and the board itself. The server checks who may change what; `canEdit`
 * only decides what is offered.
 */

export type { BoardData, BoardVisit, TechnicianRecord, VisitDetail, VisitSuggestion };

/** What a screen sends: the schemas' input, before their trims. */
export type TechnicianProfileInput = z.input<typeof technicianProfileSchema>;
export type VisitActionInput = z.input<typeof visitActionSchema>;
export type BoardActionInput = z.input<typeof boardActionSchema>;

export interface TechniciansResponse {
  migrated: boolean;
  technicians: TechnicianRecord[];
  canEdit: boolean;
}

export interface VisitResponse {
  visit: VisitDetail;
  canEdit: boolean;
}

export interface VisitActionResult {
  ok: true;
  /** request_confirmation: prepared (WhatsApp), sent, failed or no_recipient (email). */
  outcome?: "prepared" | "sent" | "failed" | "no_recipient";
  /** request_confirmation: the message text the client gets. */
  message?: string;
  /** request_confirmation by WhatsApp: a wa.me link, or null without a phone number. */
  whatsapp?: string | null;
}

export interface BoardActionResult {
  ok: true;
  changed: number;
}

export type BoardResponse = BoardData & { canEdit: boolean };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong");
  return body as T;
}

export const visitsService = {
  technicians() {
    return request<TechniciansResponse>("/api/amc-technicians");
  },
  saveTechnician(fsmId: string, input: TechnicianProfileInput) {
    return request<{ ok: true }>(`/api/amc-technicians/${encodeURIComponent(fsmId)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  visit(visitId: string) {
    return request<VisitResponse>(`/api/amc-visits/${visitId}`);
  },
  suggest(visitId: string, date: string, time: string, duration?: number | null) {
    const params = new URLSearchParams({ suggest: "1", date, time });
    if (duration) params.set("duration", String(duration));
    return request<VisitSuggestion>(`/api/amc-visits/${visitId}?${params.toString()}`);
  },
  visitAction(visitId: string, action: VisitActionInput) {
    return request<VisitActionResult>(`/api/amc-visits/${visitId}`, {
      method: "POST",
      body: JSON.stringify(action),
    });
  },
  board(date: string) {
    return request<BoardResponse>(`/api/amc-board?date=${encodeURIComponent(date)}`);
  },
  boardAction(action: BoardActionInput) {
    return request<BoardActionResult>("/api/amc-board", {
      method: "POST",
      body: JSON.stringify(action),
    });
  },
};

/* The same calls as plain functions, for screens that import them one by one. */
export const { technicians, saveTechnician, visit, suggest, visitAction, board, boardAction } = visitsService;
