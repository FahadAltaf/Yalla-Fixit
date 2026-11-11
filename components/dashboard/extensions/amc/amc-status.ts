import type { AmcSubmissionStatus } from "./amc-types";

/* FR5.8 — nine statuses across four parties, in the Snagging badge tints
   (theme tokens, never raw palette colours). Colour carries the same
   information as the label so the queue reads at a glance: amber is
   waiting on someone, red needs the team to act, green has landed. */
export function amcStatusTone(status: AmcSubmissionStatus): string {
  switch (status) {
    case "signed":
    case "proposal_approved":
      return "bg-success/10 text-success";
    case "awaiting_approval":
    case "proposal_sent":
    case "contract_sent":
      return "bg-warning/10 text-warning";
    case "sent_back":
    case "proposal_rejected":
      return "bg-danger/10 text-danger";
    case "approved":
      return "bg-brand-50 text-brand";
    case "draft":
    default:
      return "bg-mist text-ink-soft";
  }
}
