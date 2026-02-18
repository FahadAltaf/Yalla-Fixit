"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { Session } from "@supabase/supabase-js";
import {
  signOut as signOutAction,
} from "@/modules/auth/services/auth-service";

import { usersService } from "@/modules/users";
import { User, UserRoles } from "@/types/types";
import { Settings, settingsService } from "@/modules/settings";
import { LogOut, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkAuthentication } from "@/utils/check-authentication";
import Loader from "@/components/ui/loader";

type AuthContextType = {
  user: User | null;
  userProfile: User | null;
  session: Session | null;
  loading: boolean;
  settings: Settings | null;
  
  signOut: () => Promise<void>;
  setUser: (user: User | null) => void;
  setUserProfile: (userProfile: User | null) => void;
  setSettings: (settings: Settings | null) => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);

  // Define public routes that don't require authentication
  const PUBLIC_ROUTES = [
    "/auth/login",
    "/auth/signup",
    "/auth/forgot-password",
    "/auth/reset-password",
    "/auth/accept-invite",
    "/auth/callback",
    "/home", // Landing page
  ];

  const AUTH_ROUTES = ["/auth/login", "/auth/signup"];

  // Define routes that authenticated users should be redirected from (e.g., login page)

  const checkRouteAccess = (path: string, userData: User | null) => {
    const isPublicRoute = PUBLIC_ROUTES.some(
      (route) => path === route || path.startsWith(`${route}/`)
    );

    // Case 1: Unauthenticated user trying to access protected route
    if (!userData && !isPublicRoute) {
      // Redirect to login
      window.location.href = "/auth/login";
      return false;
    }

    // Case 2: Authenticated user trying to access auth routes (login, signup)
    if (userData && AUTH_ROUTES.some((route) => path.startsWith(route))) {
      window.location.href = "/";
      return false;
    }
    return true;
  };

  // Function to get user data from Supabase and user_profile table
  const fetchUserData = async () => {
    try {
      const { user: userData } = await checkAuthentication();

      if (userData) {
        const isAccess = checkRouteAccess(
          window.location.pathname,
          userData as User
        );
        if (!isAccess) {
          // setLoading(false);
          return;
        }
        setUser(userData as unknown as User);

        // Fetch user profile_image data from user_profile table
        const userProfileData = await usersService.getUserById(
          userData?.id as string
        );
        if (userProfileData) {
          setUserProfile(userProfileData);
          setLoading(false);
        }
      } else {
        setUser(null);
        setUserProfile(null);
        setSession(null);
        setLoading(false);
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
      setUser(null);
      setUserProfile(null);
      setSession(null);
      signOut();
    }
  };

  const fetchSettings = async () => {
    const settingsData = await settingsService.getSettingsById({
      type: UserRoles.ADMIN,
    });
    localStorage.setItem("SK_PROJECT_SETTINGS", JSON.stringify(settingsData));
    if (settingsData) {
      setSettings(settingsData);
    } else {
      const getSettings = localStorage.getItem("SK_PROJECT_SETTINGS");
      if (getSettings) {
        setSettings(JSON.parse(getSettings));
      } else {
        setSettings(null);
      }
    }
  };
  // Handle auth state and routing
  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        if (!isMounted) return;
        await fetchUserData();

        if (!isMounted) return;
        await fetchSettings();
      } finally {
        // fetchUserData already handles setLoading(false),
        // so we don't touch loading state here to avoid double updates.
      }
    };

    void init();

    return () => {
      isMounted = false;
    };
  }, []);

  const signOut = async () => {
    try {
      setLoading(true);
      await signOutAction();  // ✅ That's it!
      setUser(null);
      setUserProfile(null);
      setSession(null);
      setSettings(null);
      window.location.href = "/auth/login";
    } catch (error) {
      setLoading(false);
      console.error("Sign out error:", error);
      setUser(null);
      setUserProfile(null);
      setSession(null);
      setSettings(null);
      window.location.href = "/auth/login";
    }
  };

  // Show loading state or nothing while checking auth
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader />
      </div>
    );
  }

  if (userProfile?.is_active === false) {
    return (
      <div className="h-[calc(100vh-100px)] flex justify-center items-center ">
        <div className="text-center mt-6 lg:w-[40%]">
          <XCircle className="w-16 h-16 mx-auto text-red-500 mb-4" />
          <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">
            Your account has been banned by the admin. You do not have
            permission to access this platform. Please contact your
            administrator if you believe this is an error.
          </p>
          <div className="flex justify-center w-full">
            <Button
              variant={"outline"}
              className="w-max mt-5"
              onClick={signOut}
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const value = {
    user,
    userProfile,
    session,
    loading,
    settings,
    setUserProfile,
    signOut,
    setUser,
    setSettings,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext) as AuthContextType;
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
