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
  return <Toaster position="top-center" duration={3000} richColors theme={theme} />;
}
