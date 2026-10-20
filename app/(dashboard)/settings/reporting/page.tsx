import type { Metadata } from "next";

import { ReportingSettingsPage } from "@/components/dashboard/reporting/reporting-settings-page";

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
  return <ReportingSettingsPage />;
}
