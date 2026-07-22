import { executeRESTBackend } from "@/lib/rest-server";

import type {
  AmcDocumentType,
  AmcSubmission,
  AmcSubmissionListResponse,
} from "@/components/dashboard/extensions/amc/amc-types";

export interface AmcSubmissionInput {
  status?: "draft" | "generated";
  property: AmcSubmission["property"];
  customer: AmcSubmission["customer"];
  package: AmcSubmission["package"];
  services: AmcSubmission["services"];
  discount_percent: number;
  discount_amount: number;
  final_price: number;
  generated_documents?: AmcDocumentType[];
}

export interface AmcSubmissionUpdateInput extends Partial<AmcSubmissionInput> {
  id: string;
}

export const amcSubmissionsService = {
  listSubmissions: async (): Promise<AmcSubmissionListResponse> => {
    return executeRESTBackend<AmcSubmissionListResponse>("/api/amc-submissions", {
      method: "GET",
    });
  },

  getSubmission: async (id: string): Promise<AmcSubmission> => {
    return executeRESTBackend<AmcSubmission>("/api/amc-submissions", {
      method: "GET",
      params: { id },
    });
  },

  createSubmission: async (data: AmcSubmissionInput): Promise<AmcSubmission> => {
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
