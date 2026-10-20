import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rabbit Hole",
    short_name: "Rabbit Hole",
    description:
      "Start with a film, musician or book you love and follow three discoveries in other media.",
    start_url: "/",
    display: "standalone",
    background_color: "#131411",
    theme_color: "#131411",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
