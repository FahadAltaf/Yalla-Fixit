"use client";

import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  ReactNode,
  startTransition,
} from "react";
import { useAuth } from "./AuthContext";

export type Theme = "light" | "dark" | "system";

type ThemeContextType = {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  primaryColor: string;
  secondaryColor: string;
  setPrimaryColor: (color: string) => void;
  setSecondaryColor: (color: string) => void;
  siteTitle: string;
  setSiteTitle: (title: string) => void;
  favicon: string;
  setFavicon: (url: string) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useAuth();
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem("theme") as Theme) || "light";
  });

  // Kaizen brand red. This is the design system's primary and the value
  // the app falls back to before settings load, or when no primary has
  // been chosen. The previous default was an HSL channel fragment left
  // over from an older shadcn version, which does not resolve at all in
  // this codebase's rgb()/hex tokens.
  const [primaryColor, setPrimaryColorState] = useState<string>("#8C1D24");

  const [secondaryColor, setSecondaryColorState] =
    useState<string>("160 90% 44%");

  const [siteTitle, setSiteTitleState] = useState<string>(
    process.env.NEXT_PUBLIC_SITE_NAME || ""
  );

  const [favicon, setFaviconState] = useState<string>("/favicon.ico");

  useEffect(() => {
    if (settings) {
      // Batch state updates to prevent cascading renders
      startTransition(() => {
        setThemeState(settings.appearance_theme as Theme);
        setPrimaryColorState((settings.primary_color as string) || "#8C1D24");
        setSecondaryColorState(settings.secondary_color as string);
        setSiteTitleState(settings.site_name as string);
        setFaviconState(settings.favicon_url as string);
      });
    }
  }, [settings]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");

    const effectiveTheme =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;

    root.classList.add(effectiveTheme);

    // Save theme preference
    localStorage.setItem("theme", theme);

    // System theme listener
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      if (theme === "system") {
        const newTheme = mediaQuery.matches ? "dark" : "light";
        root.classList.remove("light", "dark");
        root.classList.add(newTheme);
      }
    };

    if (theme === "system") {
      mediaQuery.addEventListener("change", handleSystemThemeChange);
    }

    return () => {
      if (theme === "system") {
        mediaQuery.removeEventListener("change", handleSystemThemeChange);
      }
    };
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--primary", primaryColor);

    /*
      The brand end of the chart ramp, tinted rather than repeated.

      This used to stamp the tenant's primary colour onto --chart-1
      through --chart-4 identically, which collapsed a five-step ramp
      into one colour: every line, bar and segment in the app came out
      the same red, so a two-series chart had two indistinguishable
      series and a six-stage pipeline read as one block. Only --chart-5
      survived, because it was the one the loop did not reach.

      Chart 1 stays the brand colour exactly. Charts 2 and 3 are lighter
      mixes of it, so a single-hue ramp still reads as one family. Charts
      4 and 5 are deliberately left alone — they are the neutral end of
      the ramp defined in globals.css, and a chart needs somewhere
      uncoloured to put the data that carries no meaning.
    */
    root.style.setProperty("--chart-1", primaryColor);
    root.style.setProperty("--chart-2", mixWithWhite(primaryColor, 0.3));
    root.style.setProperty("--chart-3", mixWithWhite(primaryColor, 0.55));

    // root.style.setProperty("--secondary", secondaryColor);
    localStorage.setItem("primaryColor", primaryColor);
    localStorage.setItem("secondaryColor", secondaryColor);
  }, [primaryColor, secondaryColor]);

  useEffect(() => {
    // Update document title when site title changes
    if (typeof document !== "undefined") {
      document.title = siteTitle;
    }
    localStorage.setItem("siteTitle", siteTitle);
  }, [siteTitle]);

  useEffect(() => {
    // Update favicon when it changes
    if (typeof document !== "undefined" && favicon) {
      const faviconElement = document.querySelector(
        "link[rel='icon']"
      ) as HTMLLinkElement;
      if (faviconElement) {
        faviconElement.href = favicon;
      } else {
        const newFavicon = document.createElement("link");
        newFavicon.rel = "icon";
        newFavicon.href = favicon;
        document.head.appendChild(newFavicon);
      }
    }
    localStorage.setItem("favicon", favicon);
  }, [favicon]);

  const toggleTheme = () => {
    setThemeState((prevTheme) => {
      switch (prevTheme) {
        case "light":
          return "dark";
        case "dark":
          return "system";
        case "system":
        default:
          return "light";
      }
    });
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const setPrimaryColor = (color: string) => {
    setPrimaryColorState(color);
  };

  const setSecondaryColor = (color: string) => {
    setSecondaryColorState(color);
  };

  const setSiteTitle = (title: string) => {
    setSiteTitleState(title);
  };

  const setFavicon = (url: string) => {
    setFaviconState(url);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme,
        setTheme,
        primaryColor,
        secondaryColor,
        setPrimaryColor,
        setSecondaryColor,
        siteTitle,
        setSiteTitle,
        favicon,
        setFavicon,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

/**
 * A lighter step of a hex colour, for building a single-hue ramp.
 *
 * Falls back to the colour untouched if it is not a plain 6-digit hex —
 * a themed value that arrives as oklch or a named colour should show as
 * itself rather than as black.
 */
function mixWithWhite(hex: string, amount: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;

  const value = parseInt(match[1], 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const lifted = channels.map((channel) =>
    Math.round(channel + (255 - channel) * amount),
  );
  return `#${lifted.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
