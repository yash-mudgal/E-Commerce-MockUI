import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:5080";

/**
 * Product images are served from object storage (Media:PublicBaseUrl in the API). With a public media host
 * (CDN), Next.js resizes them; for local hosts (MinIO, test servers) optimisation is off because the image
 * optimiser refuses private addresses, so images load straight from storage.
 */
const mediaUrl = process.env.MEDIA_PUBLIC_URL;
const localMedia = !mediaUrl || /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|minio\b)/.test(mediaUrl);

const isProd = process.env.NODE_ENV === "production";
const origin = (url: string | undefined) => { try { return url ? new URL(url).origin : ""; } catch { return ""; } };
// Browsers upload product images straight to object storage with presigned URLs (S3 in production, MinIO locally).
const uploadOrigin = origin(process.env.MEDIA_UPLOAD_ORIGIN) || (isProd ? "" : "http://localhost:9000 http://localhost:4566");

/**
 * Content-Security-Policy (SECURITY_PLAN §4a). Next.js and the storefront's brand colour use inline scripts and
 * styles, so script-src keeps 'unsafe-inline' (no nonces: they would make every page dynamic); everything else is
 * locked down: no plugins, no framing of our pages, forms and base URLs to our origin only, scripts and frames
 * only from us and Razorpay Checkout. Images may come from any HTTPS host (product media CDN).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"} https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${origin(process.env.MEDIA_PUBLIC_URL)}${isProd ? "" : " http://localhost:*"}`.replace(/ +/g, " ").trim(),
  "font-src 'self' data:",
  `connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com ${uploadOrigin}`.trim(),
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.razorpay.com\" \"https://api.razorpay.com\")" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
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
