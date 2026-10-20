import type { NextConfig } from "next";
const config: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.qloo.com",
        port: "",
        pathname: "/**",
        search: "",
      },
    ],
    maximumRedirects: 0,
    formats: ["image/webp"],
    imageSizes: [64, 96, 160, 256, 384],
    qualities: [75],
  },
  logging: { incomingRequests: { ignore: [/^\/s\//] } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/fonts/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      ...["/api/:path*", "/t/:path*", "/s/:path*", "/compare/:path*"].map(
        (source) => ({
          source,
          headers: [{ key: "Cache-Control", value: "private, no-store" }],
        }),
      ),
    ];
  },
};
export default config;
