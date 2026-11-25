"use client";

import { ReactNode } from "react";
import { Toaster } from "sonner";

import { ThemeProvider, useTheme } from "@/context/ThemeContext";

export function ThemeProviderWrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

/**
 * The app-wide toaster, following the app theme.
 *
 * Sonner defaults to its light theme and does not read the class on
 * <html>, so in dark mode every toast was a white card. It takes the same
 * light / dark / system value the app does; "system" resolves against
 * prefers-color-scheme in both, so the two cannot disagree.
 */
export function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <>
      <Toaster position="top-center" duration={3000} richColors theme={theme} />
      {/* New notifications as they arrive (23 Nov 2026): they stay until closed. */}
      {/* Styled as the page notices (components/ui/alert.tsx): card, icon, title, muted description. */}
      <Toaster
        id={LIVE_TOASTER}
        position="bottom-right"
        visibleToasts={4}
        closeButton
        theme={theme}
        toastOptions={{
          classNames: {
            toast: "!bg-card !text-card-foreground !border-border !rounded-lg !shadow-lg !items-start !gap-2.5 !px-3.5 !py-3",
            icon: "!mt-0.5 !text-primary",
            title: "!text-sm !font-medium",
            description: "!text-muted-foreground !text-sm",
            actionButton: "!bg-primary !text-primary-foreground !rounded-md !font-medium",
            closeButton: "!bg-card !text-muted-foreground !border-border hover:!text-foreground",
          },
        }}
      />
    </>
  );
}

/** The corner toaster for live notifications (components/dashboard/notifications/use-live-notifications.ts). */
export const LIVE_TOASTER = "live-notifications";
