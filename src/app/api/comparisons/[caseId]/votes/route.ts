import { api } from "@/lib/core/http";
export const maxDuration = 60;
export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  return api("votes", request, await context.params);
}
