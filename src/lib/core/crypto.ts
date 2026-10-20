import "server-only";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { AppError } from "./errors";
export const randomId = () => randomBytes(24).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const localRuntime = globalThis as typeof globalThis & {
  rabbitSecrets?: { session: string; share: string };
};
const localSecrets = (localRuntime.rabbitSecrets ??= {
  session: randomId(),
  share: randomId(),
});
export function secret(kind: "session" | "share"): string {
  const value =
    process.env[kind === "session" ? "SESSION_SECRET" : "SHARE_TOKEN_SECRET"];
  if (value && value.length >= 32) return value;
  if (
    kind === "share" &&
    !value &&
    (process.env.SESSION_SECRET?.length ?? 0) >= 32
  )
    return createHmac("sha256", process.env.SESSION_SECRET!)
      .update("rabbit-hole:share-encryption:v1")
      .digest("hex");
  if (
    process.env.NODE_ENV !== "production" ||
    (process.env.ALLOW_MEMORY_STORE === "1" &&
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
        process.env.APP_ORIGIN ?? "",
      ))
  )
    return localSecrets[kind];
  throw new AppError("configuration", 503);
}
const sign = (id: string) =>
  createHmac("sha256", secret("session")).update(id).digest("base64url");
export function signedSession(id: string) {
  return `${id}.${sign(id)}`;
}
export function verifySession(value?: string): string | undefined {
  if (!value) return;
  const [id, signature, extra] = value.split(".");
  if (!id || !signature || extra || !/^[\w-]{32}$/.test(id)) return;
  const expected = sign(id);
  if (
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return hash(id);
}
export function encryptToken(token: string, shareId: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      createHash("sha256").update(secret("share")).digest(),
      iv,
    );
  cipher.setAAD(Buffer.from(shareId));
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decryptToken(value: string, shareId: string): string {
  const parts = value.split(".");
  if (
    parts.length !== 3 ||
    parts.some(
      (part) =>
        !/^[\w-]+$/.test(part) ||
        Buffer.from(part, "base64url").toString("base64url") !== part,
    )
  )
    throw new AppError("input", 400);
  const [iv, tag, encrypted] = parts.map((part) =>
    Buffer.from(part, "base64url"),
  );
  const cipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(secret("share")).digest(),
    iv,
  );
  cipher.setAAD(Buffer.from(shareId));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString(
    "utf8",
  );
}
export function ipHash(ip: string, now = Date.now()) {
  return createHmac("sha256", secret("session"))
    .update(`${new Date(now).toISOString().slice(0, 10)}:${ip}`)
    .digest("hex");
}
