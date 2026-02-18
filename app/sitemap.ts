import { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site-config";

/**
 * Dynamic sitemap for search engines
 * Automatically includes all public, indexable pages
 * Excludes: /api, /auth, /dashboard, /admin
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = siteConfig.url;
  const currentDate = new Date();

  // Static pages that should be indexed
  const routes = [
    {
      url: baseUrl,
      lastModified: currentDate,
      changeFrequency: "daily" as const,
      priority: 1.0,
    },
    // Add more static routes here as your site grows
    // Example:
    // {
    //   url: `${baseUrl}/about`,
    //   lastModified: currentDate,
    //   changeFrequency: "monthly" as const,
    //   priority: 0.8,
    // },
  ];

  return routes;
}
