import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

// Trail (/t/) and share (/s/) pages stay crawlable so link previews work, and
// carry noindex instead. Only the API is off limits.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
