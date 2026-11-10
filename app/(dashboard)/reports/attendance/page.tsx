import { Suspense } from "react";
import type { Metadata } from "next";

import { AttendancePage } from "@/components/dashboard/reports/attendance-page";

export const metadata: Metadata = {
  title: "Daily attendance | Reports",
  robots: { index: false, follow: false },
};

/* Daily attendance (BRD 5.2 B5). The API checks Attendance View. Suspense: the page reads its link's filters. */
export default function AttendanceRoute() {
  return (
    <Suspense>
      <AttendancePage />
    </Suspense>
  );
}
