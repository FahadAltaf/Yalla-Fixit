"use client";

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
    </div>
  );
}
