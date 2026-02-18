import { Metadata } from "next";
import { siteConfig } from "./site-config";

/**
 * SEO Utility Functions
 * Helper functions to generate consistent SEO metadata across pages
 */

interface PageSEOProps {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  noIndex?: boolean;
  keywords?: string[];
}

/**
 * Generate complete SEO metadata for a page
 * @param props - SEO configuration for the page
 * @returns Complete Metadata object for Next.js
 */
export function generatePageSEO({
  title,
  description,
  path,
  ogImage,
  noIndex = false,
  keywords = [],
}: PageSEOProps): Metadata {
  const url = `${siteConfig.url}${path}`;
  const image = ogImage || `${siteConfig.url}/og-image.jpg`;

  return {
    title,
    description,
    keywords: [...siteConfig.keywords, ...keywords],
    openGraph: {
      title: `${title} | ${siteConfig.name}`,
      description,
      url,
      siteName: siteConfig.name,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${siteConfig.name}`,
      description,
      images: [image],
      creator: siteConfig.creator.twitter,
    },
    alternates: {
      canonical: path,
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
        }
      : {
          index: true,
          follow: true,
        },
  };
}

/**
 * Generate SEO metadata for blog posts/articles
 */
interface ArticleSEOProps {
  title: string;
  description: string;
  path: string;
  publishedTime: string;
  modifiedTime?: string;
  authors: string[];
  tags?: string[];
  ogImage?: string;
}

export function generateArticleSEO({
  title,
  description,
  path,
  publishedTime,
  modifiedTime,
  authors,
  tags = [],
  ogImage,
}: ArticleSEOProps): Metadata {
  const url = `${siteConfig.url}${path}`;
  const image = ogImage || `${siteConfig.url}/og-image.jpg`;

  return {
    title,
    description,
    keywords: [...siteConfig.keywords, ...tags],
    authors: authors.map((name) => ({ name })),
    openGraph: {
      title: `${title} | ${siteConfig.name}`,
      description,
      url,
      siteName: siteConfig.name,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      locale: "en_US",
      type: "article",
      publishedTime,
      modifiedTime: modifiedTime || publishedTime,
      authors,
      tags,
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${siteConfig.name}`,
      description,
      images: [image],
      creator: siteConfig.creator.twitter,
    },
    alternates: {
      canonical: path,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

/**
 * Generate private page metadata (no indexing)
 */
export function generatePrivatePageSEO(title: string): Metadata {
  return {
    title,
    robots: {
      index: false,
      follow: false,
    },
  };
}

/**
 * Truncate text to fit SEO guidelines
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Validate SEO title length (50-60 characters)
 */
export function validateTitleLength(title: string): {
  isValid: boolean;
  message?: string;
} {
  const length = title.length;
  if (length < 50) {
    return {
      isValid: false,
      message: `Title too short (${length} chars). Aim for 50-60 characters.`,
    };
  }
  if (length > 60) {
    return {
      isValid: false,
      message: `Title too long (${length} chars). Aim for 50-60 characters.`,
    };
  }
  return { isValid: true };
}

/**
 * Validate SEO description length (140-160 characters)
 */
export function validateDescriptionLength(description: string): {
  isValid: boolean;
  message?: string;
} {
  const length = description.length;
  if (length < 140) {
    return {
      isValid: false,
      message: `Description too short (${length} chars). Aim for 140-160 characters.`,
    };
  }
  if (length > 160) {
    return {
      isValid: false,
      message: `Description too long (${length} chars). Aim for 140-160 characters.`,
    };
  }
  return { isValid: true };
}
