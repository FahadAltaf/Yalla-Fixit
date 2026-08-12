import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
    // Pins CSS `@import "tailwindcss"` resolution to this project's own
    // node_modules. NOTE: on Windows this only holds when the dev server is
    // launched from the correctly-cased project folder — `npm run dev` /
    // `bun run dev` go through `scripts/dev.mjs`, which chdir's to the real
    // casing first so `cd portal` (lowercase) can't break it.
    resolveAlias: {
      tailwindcss: path.join(__dirname, "node_modules/tailwindcss"),
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

export default nextConfig;
