import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReportingSettingsPage } from "@/components/dashboard/reporting/reporting-settings-page";
import { REPORTS_ENABLED } from "@/lib/reports/enabled";

export const metadata: Metadata = {
  title: "Reporting | Settings",
  robots: { index: false, follow: false },
};

/*
  Reporting Settings (BRD §6.4, §6.6). The API decides who may read and
  change them (Reporting settings View / Edit); the page only shows what it
  is given.
*/
export default function ReportingSettingsRoute() {
  /* Part of the Reports module: hidden while it is switched off (lib/reports/enabled.ts). */
  if (!REPORTS_ENABLED) notFound();
  return <ReportingSettingsPage />;
}
