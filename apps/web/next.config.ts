import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:5080";

/**
 * Product images are served from object storage (Media:PublicBaseUrl in the API). With a public media host
 * (CDN), Next.js resizes them; for local hosts (MinIO, test servers) optimisation is off because the image
 * optimiser refuses private addresses, so images load straight from storage.
 */
const mediaUrl = process.env.MEDIA_PUBLIC_URL;
const localMedia = !mediaUrl || /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|minio\b)/.test(mediaUrl);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone",
  poweredByHeader: false,
  images: {
    unoptimized: localMedia,
    remotePatterns: mediaUrl ? [new URL(`${mediaUrl.replace(/\/$/, "")}/**`)] : [],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Same-origin API: the browser calls /api/*, Next.js forwards to the ASP.NET Core API, and the session
  // cookie stays first-party (docs/SYSTEM_ARCHITECTURE.md §1).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
