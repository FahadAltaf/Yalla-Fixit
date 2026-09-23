"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import React from "react";

import { checkRouteAccess } from "@/components/auth/check-route-access";
import { getNavData } from "@/components/dashboard-layout/menu-items";
import { User } from "@/types/types";
import { useAuth } from "@/context/AuthContext";
import Loader from "@/components/ui/loader";

export interface WithUserRole {
  user?: User | null;
}

interface CheckUserRoleProps {
  children:
    | React.ReactElement<WithUserRole>
    | ((props: WithUserRole) => React.ReactElement);
}

// Define public routes that don't require authentication
const AUTH_ROUTES = [
  "/auth/login",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/accept-invite",
];

export default function CheckUserRole({ children }: CheckUserRoleProps) {
  const pathname = usePathname();
  /*
    The signed-in user comes from AuthContext, which has already asked the
    server by the time this renders: AuthProvider shows its loader until
    that check is done, so `user` here is its final answer (null when
    signed out). This component used to call checkAuthentication() a
    second time on every load, in production too.
  */
  const { user, userProfile } = useAuth();

  /*
    Decided while rendering, not after: the menu-based route check is plain
    synchronous logic over the profile the page already has (the server
    sends it with the page). It used to run in an effect, so every page
    rendered a loader first and only showed itself after it had loaded in
    the browser. The redirects are the same as before.
  */
  // Decided once, when the dashboard first mounts -- as it always was;
  // moving between pages inside the app is not re-checked here.
  const [verdict] = useState<"allowed" | "to-home" | "to-login">(() => {
    const onAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));
    if (user?.id && onAuthRoute) return "to-home";
    if (!user?.id) return "to-login";
    try {
      return checkRouteAccess(pathname, getNavData(userProfile ?? ({} as User)).navMain)
        ? "allowed"
        : "to-home";
    } catch (error) {
      console.error("Route permission check failed:", error);
      return "to-home";
    }
  });

  useEffect(() => {
    if (verdict === "to-login") window.location.href = "/auth/login";
    else if (verdict === "to-home") window.location.href = "/";
  }, [verdict]);

  if (verdict !== "allowed") {
    return (
      <div className="min-h-screen justify-center items-center flex">
        <Loader />
      </div>
    );
  }

  // Handle both function children and element children
  if (typeof children === "function") {
    return children({ user: userProfile });
  }

  // Clone the children and pass the userRole as a prop
  const childrenWithRole = React.Children.map(children, (child) => {
    if (React.isValidElement<WithUserRole>(child)) {
      return React.cloneElement(child, {
        user: userProfile,
      } as WithUserRole);
    }
    return child;
  });

  return <>{childrenWithRole}</>;
}
