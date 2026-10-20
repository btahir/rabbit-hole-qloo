import "server-only";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { redisClient } from "./store";
import type { Entity } from "./types";
import { safeInformationUrl, safeImageUrl } from "./entities";
export const liveIdentitySchema = z
  .object({
    id: z.uuid(),
    medium: z.enum(["movie", "artist", "book"]),
    name: z.string().min(1).max(300),
    year: z.number().int().optional(),
    author: z.string().max(200).optional(),
    disambiguation: z.string().max(200).optional(),
    description: z.string().max(160).optional(),
    narrativeFacts: z.string().max(600).optional(),
    informationUrl: z
      .string()
      .refine((value) => !!safeInformationUrl(value))
      .optional(),
    imageUrl: z
      .string()
      .refine((value) => !!safeImageUrl(value))
      .optional(),
    source: z.literal("Qloo"),
    checkedAt: z.iso.datetime(),
    schemaVersion: z.literal(1),
  })
  .strict();
export const reviewGateSchema = z
  .object({
    checkedAt: z.iso.datetime(),
    evidenceRefs: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  })
  .strict();
export const sampleReviewSchema = z
  .object({
    entityId: z.uuid(),
    identity: reviewGateSchema,
    discovery: reviewGateSchema,
    ranking: reviewGateSchema,
    exclusions: reviewGateSchema,
    popularity: reviewGateSchema,
    explanation: reviewGateSchema,
    outbound: reviewGateSchema,
  })
  .strict();
export const activationSchema = z
  .object({
    identity: liveIdentitySchema,
    activatedAt: z.iso.datetime(),
    review: sampleReviewSchema,
  })
  .strict()
  .refine(
    (item) =>
      item.identity.id.toLowerCase() === item.review.entityId.toLowerCase(),
  );
/** Automated checks are deliberately separate from operator review attestations. */
export const releaseSampleSchema = z
  .object({
    identity: liveIdentitySchema,
    preparedAt: z.iso.datetime(),
    method: z.literal("live-discovery-and-model-selection"),
    comparisonId: z.string().min(1).max(100),
  })
  .strict();
/** Read release-prepared samples or a legacy operator-reviewed manifest.
 * Public clients cannot enable samples or submit activations. */
export async function activatedSamples(): Promise<Entity[]> {
  if (!process.env.QLOO_API_KEY) return [];
  const redis = redisClient();
  if (redis) {
    try {
      const prepared = z
        .array(releaseSampleSchema)
        .length(3)
        .safeParse(
          await redis.get(
            `rabbit-hole:${process.env.ENTITLEMENT_NAMESPACE || "default"}:samples:v2`,
          ),
        );
      if (
        prepared.success &&
        new Set(prepared.data.map((s) => s.identity.medium)).size === 3
      )
        return prepared.data.map((s) => s.identity);
    } catch {
      return [];
    }
  }
  let raw: unknown = redis
    ? await redis
        .get(
          `rabbit-hole:${process.env.ENTITLEMENT_NAMESPACE || "default"}:samples:v1`,
        )
        .catch(() => null)
    : null;
  if (
    !redis &&
    (process.env.NODE_ENV !== "production" ||
      (process.env.ALLOW_MEMORY_STORE === "1" &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(
          process.env.APP_ORIGIN ?? "",
        )))
  ) {
    try {
      raw = JSON.parse(await readFile(".cache/activated-samples.json", "utf8"));
    } catch {
      return [];
    }
  }
  if (raw === null) return [];
  const parsed = z.array(activationSchema).length(3).safeParse(raw);
  if (
    !parsed.success ||
    new Set(parsed.data.map((s) => s.identity.medium)).size !== 3
  )
    return [];
  return parsed.data.map((s) => s.identity);
}
