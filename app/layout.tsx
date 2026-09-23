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
import { loadSignedInUser } from "@/utils/load-signed-in-user";

/**
 * Who is signed in, read on the server with the page.
 *
 * The browser used to learn this only after the page had loaded, behind a
 * full-screen loader, and only then could any page start on its own data.
 * Now every page arrives already knowing, so there is no loader to sit
 * through. `undefined` means "could not tell" (a transient failure), and
 * the browser then asks for itself exactly as it always did.
 */
async function initialAuth() {
  try {
    return await loadSignedInUser();
  } catch (error) {
    console.error("Signed-in user (server) failed; the browser will check:", error);
    return undefined;
  }
}

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const auth = await initialAuth();
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
        <AuthProvider initialAuth={auth}>
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
