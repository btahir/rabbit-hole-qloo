import type { Metadata, Viewport } from "next";
import "./globals.css";
import { siteDescription, siteOrigin } from "@/lib/site";
import { earlyIntentScript } from "@/components/early-intent";
const title = "Rabbit Hole: follow a film into music and books";
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: { default: title, template: "%s | Rabbit Hole" },
  description: siteDescription,
  applicationName: "Rabbit Hole",
  openGraph: {
    type: "website",
    siteName: "Rabbit Hole",
    title,
    description: siteDescription,
    url: "/",
  },
  twitter: { card: "summary_large_image", title, description: siteDescription },
  referrer: "no-referrer",
};
export const viewport: Viewport = { themeColor: "#131411" };
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The early-intent script may mark <html> before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/anton-v1.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/manrope-latin-v1.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: earlyIntentScript }} />
        {children}
      </body>
    </html>
  );
}
