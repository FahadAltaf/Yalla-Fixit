import type { Metadata } from "next";

import { AppearanceSettingsPage } from "@/components/dashboard/settings";

export const metadata: Metadata = {
  title: "Appearance | Settings",
  robots: { index: false, follow: false },
};

export default function AppearanceSettingsRoute() {
  return <AppearanceSettingsPage />;
}
