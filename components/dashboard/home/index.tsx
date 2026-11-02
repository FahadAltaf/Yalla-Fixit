"use client";

import { HomeNotificationsPanel } from "@/components/dashboard/notifications/home-notifications-panel";
import { PageHeading } from "@/components/dashboard/shared/kaizen";
import { useAuth } from "@/context/AuthContext";

/**
 * The home page.
 *
 * A greeting and nothing else, deliberately. The page carried a set of
 * stat tiles and three lists -- the review queue, proposals awaiting
 * approval, your todos -- and every one of them repeated a module that
 * already has its own page and its own heading. Pointing at the sidebar
 * is honest; four counts that go stale the moment you open the module
 * behind them are not.
 *
 * Each module's own landing page is where its figures belong: Snagging
 * Overview for throughput and the attention list, AMC proposals for the
 * approval queue, Todos for the list.
 *
 * The one exception is unread notifications, which BRD §6.2 puts here
 * until they are opened. The panel is absent when there are none, so the
 * page stays a greeting the rest of the time.
 */
export default function HomeDashboard() {
  const { userProfile } = useAuth();

  const name = userProfile?.first_name?.trim() || userProfile?.full_name?.trim();

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Home"
        title={name ? `Welcome back, ${name}` : "Welcome back"}
        description="Pick a module from the sidebar to get started."
      />
      <HomeNotificationsPanel />
    </div>
  );
}
