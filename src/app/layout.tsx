import type { Metadata } from "next";
import "./globals.css";
import { earlyIntentScript } from "@/components/early-intent";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_ORIGIN || "http://localhost:3000"),
  title: "Rabbit Hole",
  description: "Follow three discoveries across films, music and books.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
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
