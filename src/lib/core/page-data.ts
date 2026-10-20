import "server-only";
import { connection } from "next/server";
import { cookies, headers } from "next/headers";
import { COOKIE } from "./http";
import { verifySession, ipHash } from "./crypto";
import { AppError, errorCopy } from "./errors";
import { store } from "./store";
import { TrailService } from "./service";
import { clientIp } from "./config";
export async function pageIdentity() {
  await connection();
  const [jar, head] = await Promise.all([cookies(), headers()]);
  return {
    owner: verifySession(jar.get(COOKIE)?.value),
    ip: ipHash(clientIp(head)),
  };
}
export async function ownerPage(trailId: string) {
  const { owner, ip } = await pageIdentity();
  try {
    if (!owner) throw new AppError("owner", 403);
    return { trail: await new TrailService(store()).read(owner, trailId, ip) };
  } catch (error) {
    const e = error instanceof AppError ? error : new AppError("storage", 503);
    return {
      error: {
        error: e.code,
        operation: "read" as const,
        retryAt: e.retryAt,
        heading: errorCopy[e.code][0],
        body: errorCopy[e.code][1],
      },
    };
  }
}
