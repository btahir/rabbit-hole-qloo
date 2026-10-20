import { renderBrandImage } from "@/lib/core/brand-image";

export const alt =
  "Rabbit Hole. What do you love? One favourite leads from film to music to books.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return renderBrandImage(size.width, size.height);
}
