import "server-only";
import { cache } from "react";
import { pageIdentity } from "./page-data";
import { TrailService } from "./service";
import { store } from "./store";
import { AppError } from "./errors";

// Deduplicate metadata and page reads within the same render. No inference.
export const sharedTrail = cache(async (token: string) => {
  if (!/^[\w-]{32}$/.test(token)) throw new AppError("missing", 404);
  const { owner, ip } = await pageIdentity();
  return new TrailService(store()).visitor(token, owner ?? ip, ip);
});
