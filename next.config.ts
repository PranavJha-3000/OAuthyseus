import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Curated guides are read from /data at build time; keep them in the server bundle.
  outputFileTracingIncludes: {
    "/**": ["./data/guides/**/*.json"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
