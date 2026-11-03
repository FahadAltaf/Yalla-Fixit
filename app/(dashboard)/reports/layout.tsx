import { notFound } from "next/navigation";

import { REPORTS_ENABLED } from "@/lib/reports/enabled";

// Every /reports page is hidden while the Reports module is switched off
// (lib/reports/enabled.ts): a link to one shows the not-found page.
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  if (!REPORTS_ENABLED) notFound();
  return <>{children}</>;
}
