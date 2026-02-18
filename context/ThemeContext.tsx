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

  const [primaryColor, setPrimaryColorState] = useState<string>("220 90% 56%");

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
        setPrimaryColorState(settings.primary_color as string);
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
    root.style.setProperty("--chart-1", primaryColor);
    root.style.setProperty("--chart-2", primaryColor);
    root.style.setProperty("--chart-3", primaryColor);
    root.style.setProperty("--chart-4", primaryColor);

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
