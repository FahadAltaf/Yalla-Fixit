"use client";

import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  useRef,
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

  // Read by the system-theme listener, which outlives the render that
  // registered it, so it re-applies the current tenant colour.
  const primaryColorRef = useRef(primaryColor);
  useEffect(() => {
    primaryColorRef.current = primaryColor;
  }, [primaryColor]);

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
        applyBrandPalette(primaryColorRef.current);
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

  // Runs after the theme effect above (effects run in declaration
  // order), so the html element already carries the new light/dark class
  // when the palette reads it.
  useEffect(() => {
    applyBrandPalette(primaryColor);

    // root.style.setProperty("--secondary", secondaryColor);
    localStorage.setItem("primaryColor", primaryColor);
    localStorage.setItem("secondaryColor", secondaryColor);
  }, [primaryColor, secondaryColor, theme]);

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

const KAIZEN_PRIMARY = "#8c1d24";

/**
 * Writes the tenant's primary colour onto the root element.
 *
 * Inline custom properties outrank every stylesheet rule, including the
 * `.dark` block in globals.css. This used to stamp the light brand red
 * (#8C1D24) onto --primary in both themes, so in dark mode every
 * `text-primary` link, focus accent and chart series came out dark red on
 * near-black (about 2:1) and the designed dark primary never applied.
 *
 * Light mode: the tenant colour exactly, as before.
 * Dark mode, default Kaizen red: the inline values are removed so the
 *   dark values designed in globals.css apply (a brighter brand red for
 *   fills, with white text, and a light tone for brand-coloured words).
 * Dark mode, a tenant's own colour: the same split. The fill is the
 *   tenant's colour itself, as in light -- brightened only when it is so
 *   dark it would sink into the surface -- and its text is white, or ink
 *   on a colour too pale to carry white. Words in it (--primary-text) and
 *   the chart series take a lighter step, so they read on a dark card.
 *
 * The brand end of the chart ramp is tinted rather than repeated. It used
 * to stamp the tenant's primary onto --chart-1 through --chart-4
 * identically, which collapsed a five-step ramp into one colour. Chart 1
 * is the brand colour; charts 2 and 3 are lighter mixes of it, so a
 * single-hue ramp still reads as one family. Charts 4 and 5 are left
 * alone — they are the neutral end of the ramp defined in globals.css.
 */
function applyBrandPalette(primaryColor: string) {
  const root = document.documentElement;
  const isDark = root.classList.contains("dark");
  const props = [
    "--primary",
    "--primary-foreground",
    "--primary-text",
    "--chart-1",
    "--chart-2",
    "--chart-3",
  ] as const;

  if (!isDark) {
    // Words follow the fill in light (--primary-text: var(--primary)),
    // and the text on it is the stylesheet's white.
    root.style.removeProperty("--primary-text");
    root.style.removeProperty("--primary-foreground");
    root.style.setProperty("--primary", primaryColor);
    root.style.setProperty("--chart-1", primaryColor);
    root.style.setProperty("--chart-2", mixWithWhite(primaryColor, 0.3));
    root.style.setProperty("--chart-3", mixWithWhite(primaryColor, 0.55));
    return;
  }

  if (primaryColor.trim().toLowerCase() === KAIZEN_PRIMARY) {
    props.forEach((prop) => root.style.removeProperty(prop));
    return;
  }

  const lifted = mixWithWhite(primaryColor, 0.4);
  const fill = darkFill(primaryColor);
  root.style.setProperty("--primary", fill);
  root.style.setProperty(
    "--primary-foreground",
    contrast(fill, "#ffffff") >= 4.5 ? "#ffffff" : DARK_INK,
  );
  root.style.setProperty("--primary-text", mixWithWhite(primaryColor, 0.55));
  root.style.setProperty("--chart-1", lifted);
  root.style.setProperty("--chart-2", mixWithWhite(primaryColor, 0.65));
  root.style.setProperty("--chart-3", mixWithWhite(primaryColor, 0.8));
}

/* The dark theme's card and its ink, as globals.css has them. */
const DARK_CARD = "#1d2023";
const DARK_INK = "#16181a";

/**
 * The colour a filled control takes in dark mode: the tenant's own, a
 * step brighter at a time only while it is too close to the dark card to
 * be seen as a button (under 2.3:1).
 */
function darkFill(color: string): string {
  let fill = color;
  for (let step = 1; step <= 6 && contrast(fill, DARK_CARD) < 2.3; step += 1) {
    fill = mixWithWhite(color, step * 0.06);
  }
  return fill;
}

/** WCAG contrast between two 6-digit hex colours; Infinity for anything else. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) return null;
    const value = parseInt(match[1], 16);
    const [r, g, bl] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const x = luminance(a);
  const y = luminance(b);
  if (x === null || y === null) return Infinity;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
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
