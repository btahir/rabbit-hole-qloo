import { api } from "@/lib/core/http";
export const maxDuration = 60;
export async function DELETE(
  request: Request,
  context: { params: Promise<{ shareId: string }> },
) {
  return api("share", request, await context.params);
}
