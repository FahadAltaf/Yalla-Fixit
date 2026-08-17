import { redirect } from "next/navigation";

/**
 * The approvals queue moved into the review workspace, which keeps the
 * queue and the inspection side by side. This path is kept as a
 * redirect so old links and bookmarks still land somewhere sensible.
 */
export default function SnaggingApprovalsPage() {
  redirect("/snagging/review");
}
