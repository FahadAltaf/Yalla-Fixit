"use client";

import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { useAuth } from "@/context/AuthContext";

import { AppearanceSettings } from "./appearance-settings";

export { ProfileSettings } from "./profile-settings";

/**
 * Settings has no inner menu any more: Profile, Appearance and AMC Settings
 * are pages of their own (/settings/profile, /settings/appearance,
 * /settings/amc), listed under Settings in the sidebar like Snagging's.
 *
 * Appearance needs the organisation's saved settings, which arrive with
 * the signed-in user.
 */
export function AppearanceSettingsPage() {
  const { settings } = useAuth();
  if (!settings) {
    return (
      <div className="flex flex-col gap-6">
        <HeadingSkeleton withActions />
      </div>
    );
  }
  return <AppearanceSettings settings={settings} />;
}
