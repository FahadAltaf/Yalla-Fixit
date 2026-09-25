import { redirect } from "next/navigation";

/**
 * Moved to /settings/snagging, with the rest of the admin configuration.
 *
 * Kept as a redirect rather than deleted: nothing in the app links here
 * any more, but the address has been live for months and will be sitting
 * in bookmarks and in anything the team has shared with each other.
 */
export default function SnaggingPricingPage() {
  redirect("/settings/snagging");
}
