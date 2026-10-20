import { api } from "@/lib/core/http";
export const maxDuration = 60;
export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  return api("cancel", request, await context.params);
}
