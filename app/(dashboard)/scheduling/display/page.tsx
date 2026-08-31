import type { Metadata } from "next";
import ScheduleDisplay from "@/components/dashboard/scheduling/display";

const title = "Schedule display";
const description = "Live wall-display view of the day's schedule.";

export const metadata: Metadata = {
  title,
  description,
  // An internal operations screen: never index it.
  robots: { index: false, follow: false },
};

// Sits under /scheduling so it inherits the module's VIEW permission, but
// both the dashboard chrome and the scheduling sidebar step aside for it
// (see CHROMELESS_ROUTES in components/dashboard-layout/index.tsx).
export default function ScheduleDisplayPage() {
  return <ScheduleDisplay />;
}
