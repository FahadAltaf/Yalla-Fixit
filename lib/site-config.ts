import type { Metadata } from "next";

/**
 * Site-wide SEO Configuration
 * Single source of truth for all SEO-related metadata
 */

export const siteConfig = {
  name: "YALLA FIXIT",
  description:
    "Transform your business with continuous improvement strategies. YALLA FIXIT helps teams implement lean methodologies for sustainable growth.",
  url: process.env.NEXT_PUBLIC_APP_URL || "https://yallafixit.com",
  ogImage: "/og-image.jpg",
  links: {
    twitter: "https://twitter.com/kaizenkatalyst",
    github: "https://github.com/yourusername/yallafixit",
  },
  creator: {
    name: "YALLA FIXIT Team",
    twitter: "@kaizenkatalyst",
  },
  keywords: [
    "kaizen",
    "continuous improvement",
    "lean methodology",
    "business optimization",
    "process improvement",
    "productivity tools",
  ],
};

export const seoDefaults: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
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
  openGraph: {
    type: "website" as const,
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
    card: "summary_large_image" as const,
    title: siteConfig.name,
    description: siteConfig.description,
    images: [`${siteConfig.url}/og-image.jpg`],
    creator: siteConfig.creator.twitter,
  },
};
