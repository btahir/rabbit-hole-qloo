import { renderTrailImage } from "@/lib/core/trail-image";
import { sharedTrail } from "@/lib/core/share-page";
import { AppError } from "@/lib/core/errors";

export const alt = "Rabbit Hole — one thing led to another";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  let snapshot;
  try {
    snapshot = await sharedTrail((await params).token);
  } catch (error) {
    return new Response(null, {
      status: error instanceof AppError && error.code === "missing" ? 404 : 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return renderTrailImage(snapshot);
}
