import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, errorCopy, assert } from "./errors";
import { hash, ipHash, randomId, signedSession, verifySession } from "./crypto";
import { store, RETENTION, admit } from "./store";
import { TrailService, actionSchema, keySchema, getSession } from "./service";
import { RunService, agentInput } from "./runs";
import { configuredMode } from "./fixtures";
import { qlooPort } from "./qloo";
import { applyLimits } from "./limits";
import { media, type Generation } from "./types";
import { savedComparisons } from "./saved-comparisons";
import { clientIp } from "./config";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
export const COOKIE = "rabbit_session";
export function cookieFrom(request: Request) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
}
export function ownerFrom(request: Request) {
  const owner = verifySession(cookieFrom(request));
  assert(owner, "owner", 403);
  return owner;
}
export function requestIp(request: Request) {
  return ipHash(clientIp(request.headers));
}
export function sameOrigin(request: Request) {
  const origin = process.env.APP_ORIGIN || new URL(request.url).origin;
  assert(request.headers.get("origin") === origin, "input", 403);
  const site = request.headers.get("sec-fetch-site");
  assert(!site || site === "same-origin" || site === "none", "input", 403);
}
export async function body<T extends z.ZodType>(
  request: Request,
  schema: T,
  maxCharacters = 2000,
): Promise<z.infer<T>> {
  sameOrigin(request);
  assert(
    request.headers.get("content-type")?.split(";")[0] === "application/json",
    "input",
    415,
  );
  assert(
    Number(request.headers.get("content-length") ?? 0) <= 16_384,
    "input",
    413,
  );
  const reader = request.body?.getReader();
  let total = 0,
    text = "";
  if (reader) {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.length;
        assert(total <= 16_384, "input", 413);
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel();
    }
  }
  try {
    const raw: unknown = JSON.parse(text || "{}");
    let characters = 0;
    const count = (value: unknown) => {
      if (typeof value === "string") characters += value.length;
      else if (Array.isArray(value)) value.forEach(count);
      else if (value && typeof value === "object")
        Object.values(value).forEach(count);
    };
    count(raw);
    assert(characters <= maxCharacters, "input", 413);
    return schema.parse(raw);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("input", 400);
  }
}
export function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
function renewOwnerCookie(response: NextResponse, request: Request) {
  const cookie = cookieFrom(request);
  assert(verifySession(cookie), "owner", 403);
  response.cookies.set(COOKIE, cookie!, {
    httpOnly: true,
    secure:
      new URL(process.env.APP_ORIGIN || request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: RETENTION / 1000,
  });
  return response;
}
export function fail(error: unknown) {
  const e = error instanceof AppError ? error : new AppError("storage", 503);
  const response = json(
    {
      error: e.code,
      heading: errorCopy[e.code][0],
      body: errorCopy[e.code][1],
      ...(e.retryAt ? { retryAt: e.retryAt } : {}),
    },
    e.status,
  );
  if (e.retryAt)
    response.headers.set(
      "Retry-After",
      String(Math.max(1, Math.ceil((e.retryAt - Date.now()) / 1000))),
    );
  return response;
}
export type RouteKind =
  | "session"
  | "search"
  | "trails"
  | "agent"
  | "run"
  | "cancel"
  | "actions"
  | "trail"
  | "shares"
  | "share"
  | "forks"
  | "votes";
const mutation = z
  .object({
    expectedVersion: z.number().int().min(1),
    idempotencyKey: keySchema,
  })
  .strict();
export async function api(
  kind: RouteKind,
  request: Request,
  params: Record<string, string> = {},
): Promise<Response> {
  try {
    const storage = store(),
      service = new TrailService(storage),
      runs = new RunService(storage),
      ip = requestIp(request);
    if (kind === "session") {
      await body(request, z.object({}).strict());
      const existing = verifySession(cookieFrom(request)),
        raw = existing ? undefined : randomId();
      const owner = existing ?? hash(raw!);
      const result = await service.session(owner, ip);
      const response = json(result);
      if (raw)
        response.cookies.set(COOKIE, signedSession(raw), {
          httpOnly: true,
          secure:
            new URL(process.env.APP_ORIGIN || request.url).protocol ===
            "https:",
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 86400,
        });
      return response;
    }
    const owner = ownerFrom(request);
    if (kind === "search") {
      const input = await body(
        request,
        z
          .object({
            query: z.string().trim().min(2).max(120),
            medium: z.enum(media),
          })
          .strict(),
      );
      await storage.transact((db) => {
        const s = getSession(db, owner, Date.now());
        applyLimits(db, owner, ip, "search", Date.now());
        const t = s.current ? db.trails[s.current] : undefined;
        if (t) {
          assert(t.counters.searches < 10, "trail_limit", 429);
          t.counters.searches++;
        }
      });
      const entities = await qlooPort({
        storage,
        owner,
        mode: configuredMode(),
        signal: request.signal,
      }).resolveStart(input.query, input.medium);
      await service.rememberIdentities(owner, entities);
      return json({
        state: entities.length ? "needs_input" : "empty",
        entities,
        mode: configuredMode(),
      });
    }
    if (kind === "trails") {
      const input = await body(
        request,
        z
          .object({
            entityId: z.string().max(100),
            sample: z.boolean().default(false),
            example: z.boolean().default(false),
            idempotencyKey: keySchema,
          })
          .strict(),
      );
      return renewOwnerCookie(
        json(
          await service.create(
            owner,
            ip,
            input.entityId,
            input.idempotencyKey,
            input.sample,
            input.example,
          ),
          201,
        ),
        request,
      );
    }
    if (kind === "trail") {
      if (request.method === "GET")
        return json(await service.read(owner, params.id, ip));
      const input = await body(request, mutation);
      return json(
        await service.remove(owner, params.id, input.expectedVersion, ip),
      );
    }
    if (kind === "actions") {
      const input = await body(
        request,
        z
          .object({
            expectedVersion: z.number().int().min(1),
            idempotencyKey: keySchema,
            choice: actionSchema,
          })
          .strict(),
      );
      return json(
        await service.action(
          owner,
          ip,
          params.id,
          input.expectedVersion,
          input.idempotencyKey,
          input.choice,
        ),
      );
    }
    if (kind === "shares") {
      const input = await body(
        request,
        mutation.extend({ note: z.string().trim().max(240).optional() }),
      );
      return json(
        await service.share(
          owner,
          ip,
          params.id,
          input.expectedVersion,
          input.idempotencyKey,
          input.note,
        ),
      );
    }
    if (kind === "share") {
      await body(request, z.object({ idempotencyKey: keySchema }).strict());
      return json(await service.revoke(owner, params.shareId, ip));
    }
    if (kind === "forks") {
      const input = await body(
        request,
        z
          .object({
            shareToken: z.string().regex(/^[\w-]{32}$/),
            branchPoint: z.number().int().min(0).max(2),
            idempotencyKey: keySchema,
            loveStartingPoint: z.boolean().default(false),
          })
          .strict(),
      );
      return renewOwnerCookie(
        json(
          await service.fork(
            owner,
            ip,
            input.shareToken,
            input.branchPoint,
            input.idempotencyKey,
            input.loveStartingPoint,
          ),
          201,
        ),
        request,
      );
    }
    if (kind === "run") {
      await admit(storage, owner, ip, "read");
      const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
      assert(Number.isSafeInteger(after) && after >= 0);
      const version = new URL(request.url).searchParams.get("version");
      if (version !== null) {
        assert(Number.isSafeInteger(Number(version)) && Number(version) >= 1);
        return json(
          await runs.read(owner, params.runId, after, Number(version)),
        );
      }
      return json(await runs.read(owner, params.runId, after));
    }
    if (kind === "cancel") {
      const input = await body(
        request,
        z
          .object({
            idempotencyKey: keySchema,
            trailId: z.string().max(100).optional(),
            requestKey: keySchema.optional(),
          })
          .strict(),
      );
      await storage.transact((db) =>
        applyLimits(db, owner, ip, "write", Date.now()),
      );
      if (params.runId === "pending") {
        assert(input.trailId && input.requestKey);
        return json(
          await runs.cancelPending(owner, input.trailId, input.requestKey),
        );
      }
      return json(await runs.cancel(owner, params.runId));
    }
    if (kind === "votes") {
      const input = await body(
        request,
        z
          .object({
            choice: z.enum(["Left", "Right", "Both", "Neither"]),
            caseVersion: z.string().max(100),
            familiarity: z.array(z.string().max(100)).max(24),
            armOrder: z
              .array(z.enum(["with", "without"]))
              .length(2)
              .refine((a) => new Set(a).size === 2),
            idempotencyKey: keySchema,
          })
          .strict(),
      );
      await admit(storage, owner, ip, "replay");
      const item = (await savedComparisons()).find(
        (c) => c.id === params.caseId,
      );
      assert(item);
      assert(input.caseVersion === item.evaluationId, "conflict", 409);
      const vote = await storage.transact((db) => {
        getSession(db, owner, Date.now());
        const key = `${params.caseId}:${item.evaluationId}:${owner}`;
        if (db.votes[key]) return db.votes[key];
        applyLimits(db, owner, ip, "write", Date.now());
        assert(
          input.familiarity.every((id) =>
            item.catalog.some((e) => e.id === id),
          ),
        );
        return (db.votes[key] = {
          choice: input.choice,
          caseVersion: input.caseVersion,
          familiarity: input.familiarity,
          armOrder: input.armOrder,
          expiresAt: Date.now() + RETENTION,
          at: Date.now(),
        });
      });
      return json({
        vote,
        message: "Your choice is saved for this comparison.",
      });
    }
    if (kind === "agent") {
      const input = await body(request, agentInput, 14000);
      if (input.intent === "saveResult") {
        assert(input.runId);
        await admit(storage, owner, ip, "replay");
        return json(await runs.saveResult(owner, input.runId, input.receipt));
      }
      const { run, trail, started } = await runs.begin(owner, ip, input);
      type StreamMessage = UIMessage<
        unknown,
        {
          run: {
            runId: string;
            event: (typeof run.events)[number];
            preview?: Generation;
            receipt?: string;
          };
        }
      >;
      const stream = createUIMessageStream<StreamMessage>({
        execute: async ({ writer }) => {
          const send = (
            event: (typeof run.events)[number],
            preview?: Generation,
            receipt?: string,
          ) =>
            writer.write({
              type: "data-run",
              data: {
                runId: run.id,
                event,
                ...(preview ? { preview, receipt } : {}),
              },
            });
          run.events.forEach((e) => send(e));
          if (started) await runs.execute(owner, run.id, input, trail, send);
        },
        onError: () => errorCopy.storage[0],
      });
      return createUIMessageStreamResponse({
        stream,
        headers: {
          "Cache-Control": "private, no-store",
          "X-Run-Id": run.id,
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    throw new AppError("missing", 404);
  } catch (error) {
    return fail(error);
  }
}
