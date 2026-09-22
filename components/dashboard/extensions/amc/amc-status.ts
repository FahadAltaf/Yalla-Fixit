import type { AmcSubmissionStatus } from "./amc-types";

/* FR5.8 — nine statuses across four parties. Colour carries the same
   information as the label so the queue reads at a glance: amber is
   waiting on someone, red needs the team to act, green has landed. */
export function amcStatusTone(status: AmcSubmissionStatus): string {
  switch (status) {
    case "signed":
    case "proposal_approved":
      return "bg-green-600/10 text-green-700 dark:bg-green-400/10 dark:text-green-400";
    case "awaiting_approval":
    case "proposal_sent":
    case "contract_sent":
      return "bg-amber-600/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-400";
    case "sent_back":
    case "proposal_rejected":
      return "bg-destructive/10 text-destructive";
    case "approved":
      return "bg-sky-600/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-400";
    case "draft":
    default:
      return "bg-muted text-muted-foreground";
  }
}
