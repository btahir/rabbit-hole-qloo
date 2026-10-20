import { api } from "@/lib/core/http";
export const maxDuration = 60;
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  return api("run", request, await context.params);
}
