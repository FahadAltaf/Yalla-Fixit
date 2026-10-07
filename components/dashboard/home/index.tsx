"use client";

import { PageHeading } from "@/components/dashboard/shared/kaizen";
import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { useAuth } from "@/context/AuthContext";

import { HomeNotificationsPanel } from "./notifications-panel";

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
 * The one exception is unread notifications (BRD 6.2: shown on the home
 * page until opened, then in the inbox). The panel appears only when there
 * is something to open.
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
      {canUseAmc(userProfile) ? <HomeNotificationsPanel /> : null}
    </div>
  );
}
