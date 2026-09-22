import { executeRESTBackend } from "@/lib/rest-server";

import type {
  AmcDocumentType,
  AmcSubmission,
  AmcSubmissionListResponse,
  AmcPendingApprovalsResponse,
  AmcHistoryEvent,
} from "@/components/dashboard/extensions/amc/amc-types";

export interface AmcSubmissionInput {
  /* No status: transitions belong to amcSubmissionsService.decide. */
  property: AmcSubmission["property"];
  customer: AmcSubmission["customer"];
  document_options: AmcSubmission["document_options"];
  services: AmcSubmission["services"];
  discount_percent: number;
  discount_amount: number;
  final_price: number;
  generated_documents?: AmcDocumentType[];
}

export interface AmcSubmissionUpdateInput extends Partial<AmcSubmissionInput> {
  id: string;
}

/* FR5.1–FR5.3 — the internal approval transitions. */
export type AmcApprovalAction =
  | { action: "submit"; id: string }
  | { action: "approve"; id: string }
  | { action: "send_back"; id: string; reason: string };

/* FR5.4 / FR5.6 — send to the client, or mint the link to send by hand. */
export type AmcSendInput = {
  id: string;
  document: "proposal" | "contract";
  deliver: "email" | "link";
  /* The address confirmed in the send dialog. */
  to?: string;
  /* The document as a PDF, attached to the email. */
  pdf_base64?: string;
  pdf_filename?: string;
};

export interface AmcSendResult {
  submission: AmcSubmission;
  link: string;
  emailed: boolean;
  /* Set when the document was marked sent and the link is valid but the
     email did not go — the team needs to know to copy the link. */
  warning?: string;
}

export const amcSubmissionsService = {
  send: async (input: AmcSendInput): Promise<AmcSendResult> =>
    executeRESTBackend<AmcSendResult>("/api/amc-submissions/send", {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  decide: async (
    input: AmcApprovalAction,
  ): Promise<{ submission: AmcSubmission }> =>
    executeRESTBackend<{ submission: AmcSubmission }>(
      "/api/amc-submissions/approval",
      { method: "POST", body: input as unknown as Record<string, unknown> },
    ),

  listSubmissions: async (): Promise<AmcSubmissionListResponse> => {
    return executeRESTBackend<AmcSubmissionListResponse>(
      "/api/amc-submissions",
      {
        method: "GET",
      },
    );
  },

  /* The approver's queue, for the header bell. Never throws for someone
     without AMC access: they get an empty queue. */
  listPendingApprovals: async (): Promise<AmcPendingApprovalsResponse> => {
    return executeRESTBackend<AmcPendingApprovalsResponse>(
      "/api/amc-submissions/pending-approvals",
      { method: "GET" },
    );
  },

  /* Every step a submission has been through, oldest first. */
  getHistory: async (id: string): Promise<{ events: AmcHistoryEvent[] }> =>
    executeRESTBackend<{ events: AmcHistoryEvent[] }>(
      `/api/amc-submissions/history?id=${encodeURIComponent(id)}`,
      { method: "GET" },
    ),

  getSubmission: async (id: string): Promise<AmcSubmission> => {
    return executeRESTBackend<AmcSubmission>("/api/amc-submissions", {
      method: "GET",
      params: { id },
    });
  },

  createSubmission: async (
    data: AmcSubmissionInput,
  ): Promise<AmcSubmission> => {
    return executeRESTBackend<AmcSubmission>("/api/amc-submissions", {
      method: "POST",
      body: data as unknown as Record<string, unknown>,
    });
  },

  updateSubmission: async (
    data: AmcSubmissionUpdateInput,
  ): Promise<AmcSubmission> => {
    return executeRESTBackend<AmcSubmission>("/api/amc-submissions", {
      method: "PUT",
      body: data as unknown as Record<string, unknown>,
    });
  },
};
