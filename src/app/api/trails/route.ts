import { api } from "@/lib/core/http";
export const maxDuration = 60;
export async function POST(request: Request) {
  return api("trails", request);
}
