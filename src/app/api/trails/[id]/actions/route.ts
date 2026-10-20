import { api } from "@/lib/core/http";
export const maxDuration = 60;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return api("actions", request, await context.params);
}
