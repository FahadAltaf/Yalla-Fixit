"use client";

import type { ReactNode } from "react";
import { Lock } from "lucide-react";

import { HeadingSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/context/AuthContext";

import { canViewAmcConfig } from "../amc-constants";

/** AMC configuration is open to admins and roles with AMC Configuration View. */
export function AmcConfigGate({ children }: { children: ReactNode }) {
  const { userProfile, loading } = useAuth();
  if (loading && !userProfile) {
    return (
      <div className="flex flex-col gap-6">
        <HeadingSkeleton />
      </div>
    );
  }
  if (!canViewAmcConfig(userProfile)) {
    return (
      <EmptyState
        icon={<Lock className="size-5" />}
        title="You don't have access to AMC configuration"
        description="AMC configuration is open to admins and roles with the AMC Configuration permission. Ask an admin if something needs changing."
      />
    );
  }
  return <>{children}</>;
}
