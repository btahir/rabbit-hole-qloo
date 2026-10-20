import { api } from "@/lib/core/http";
export const maxDuration = 60;
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return api("trail", request, await context.params);
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return api("trail", request, await context.params);
}
