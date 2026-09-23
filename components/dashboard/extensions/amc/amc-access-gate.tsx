"use client";

import type { ReactNode } from "react";
import { Lock } from "lucide-react";

import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/context/AuthContext";

import { canUseAmc } from "./amc-constants";

/**
 * Every AMC page sits behind this: the proposals, a proposal's detail, the
 * wizard, and AMC Settings. AMC is granted by role (view or approve), so
 * someone following a link they were sent -- or a stale bookmark -- gets a
 * plain explanation rather than a page that half-loads and then fails
 * every request.
 *
 * `adminOnly` is AMC Settings: the text every proposal is written from,
 * which only an admin changes.
 */
export function AmcAccessGate({
  children,
  adminOnly = false,
}: {
  children: ReactNode;
  adminOnly?: boolean;
}) {
  const { userProfile, loading } = useAuth();

  if (loading && !userProfile) {
    return (
      <div className="flex flex-col gap-6">
        <HeadingSkeleton />
      </div>
    );
  }

  const allowed =
    canUseAmc(userProfile) && (!adminOnly || userProfile?.roles?.name === "admin");

  if (!allowed) {
    return (
      <EmptyState
        icon={<Lock className="size-5" />}
        title={adminOnly ? "Only admins can change AMC Settings" : "You don't have access to AMC proposals"}
        description={
          adminOnly
            ? "AMC Settings holds the wording every proposal and contract is written from. Ask an admin if something needs changing."
            : "AMC proposals are open to roles with AMC access. Ask an admin to add it to your role."
        }
      />
    );
  }

  return <>{children}</>;
}
