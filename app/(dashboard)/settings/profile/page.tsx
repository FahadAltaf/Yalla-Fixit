import type { Metadata } from "next";

import { ProfileSettings } from "@/components/dashboard/settings";

export const metadata: Metadata = {
  title: "Profile | Settings",
  robots: { index: false, follow: false },
};

export default function ProfileSettingsPage() {
  return <ProfileSettings />;
}
