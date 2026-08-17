import type { Metadata } from "next";
import { Geist_Mono, Lexend, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { siteConfig } from "@/lib/site-config";
import {
  OrganizationSchema,
  WebsiteSchema,
} from "@/components/structured-data";
import { AuthProvider } from "@/context/AuthContext";
import { Toaster } from "sonner";
import { ThemeProviderWrapper } from "@/context/theme-provider-wrapper";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Kaizen type pairing: Lexend carries every heading, Source Sans 3
 * carries body copy. Both are loaded here so the whole app gets them,
 * and both are exposed as CSS variables that globals.css maps onto
 * --font-display and --font-sans.
 *
 * Only the weights the system actually specifies are requested (600-700
 * display, 400-600 body); pulling the full families would cost several
 * hundred kilobytes for faces nothing renders.
 */
const lexend = Lexend({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    "kaizen",
    "continuous improvement",
    "lean methodology",
    "business optimization",
    "process improvement",
    "productivity tools",
  ],
  authors: [{ name: siteConfig.creator.name }],
  creator: siteConfig.creator.name,
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: siteConfig.name,
    description: siteConfig.description,
    images: [
      {
        url: `${siteConfig.url}/og-image.jpg`,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
    images: [`${siteConfig.url}/og-image.jpg`],
    creator: siteConfig.creator.twitter,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/favicon.ico",
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sourceSans.variable} ${lexend.variable}`}>
      <head>
        <OrganizationSchema />
        <WebsiteSchema />
      </head>
      <body
        className={`${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <AuthProvider>
          <ThemeProviderWrapper>
            <TooltipProvider>
              {children}
            </TooltipProvider>
            <Toaster position="top-center" duration={3000} richColors />
          </ThemeProviderWrapper>
        </AuthProvider>
      </body>
    </html>
  );
}
