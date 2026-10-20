import { afterEach, expect, test, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import manifest from "@/app/manifest";

afterEach(() => vi.unstubAllEnvs());

test("robots keeps pages crawlable for link previews and blocks only the API", () => {
  vi.stubEnv("APP_ORIGIN", "https://rabbit.example");
  const result = robots();
  expect(result.rules).toEqual({
    userAgent: "*",
    allow: "/",
    disallow: "/api/",
  });
  expect(result.sitemap).toBe("https://rabbit.example/sitemap.xml");
});

test("sitemap lists only public pages, on the configured origin", () => {
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("TIFFIN_URL", "https://box.example");
  const urls = sitemap().map((entry) => entry.url);
  expect(urls).toEqual([
    "https://box.example/",
    "https://box.example/compare",
    "https://box.example/privacy",
  ]);
  expect(urls.some((url) => /\/(t|s|api)\//.test(url))).toBe(false);
});

test("manifest uses the app's dark theme and real icon files", () => {
  const result = manifest();
  expect(result.theme_color).toBe("#131411");
  expect(result.icons?.map((icon) => icon.src)).toEqual([
    "/icon.svg",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
  ]);
});
