import type { MetadataRoute } from "next";

/** robots.txt for ShopMint's own hosts (marketing, admin). Store domains get their own via proxy.ts. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/platform", "/invite", "/reset-password", "/verify-email", "/forgot-password"] },
  };
}
