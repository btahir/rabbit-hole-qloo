export const media = ["movie", "artist", "book"] as const;
export type Medium = (typeof media)[number];
export type Mode = "fixture" | "live";
export const label: Record<Medium, string> = {
  movie: "Film",
  artist: "Music",
  book: "Book",
};
export const plural: Record<Medium, string> = {
  movie: "films",
  artist: "music",
  book: "books",
};
export interface Entity {
  id: string;
  medium: Medium;
  name: string;
  year?: number;
  author?: string;
  disambiguation?: string;
  description?: string;
  narrativeFacts?: string;
  descriptionSource?: string;
  informationUrl?: string;
  imageUrl?: string;
  source: "Qloo" | "Synthetic example";
  checkedAt: string;
  schemaVersion: 1;
}
export interface Evidence {
  id: string;
  runId: string;
  kind: "discovery" | "ranking";
  anchor: Entity;
  endpoint: "/v2/insights";
  medium: Medium;
  results: {
    id: string;
    position: number;
    affinity?: number;
    explanation?: {
      status: "missing" | "unsupported" | "returned";
      contributions: { entityId: string; value: number }[];
    };
  }[];
  exclusionsCount: number;
  exclusionsHash: string;
  upstreamExclusionsCount?: number;
  localExclusionsCount?: number;
  popularityMax?: number;
  loves: Entity[];
  source: "qloo" | "synthetic";
  cache: "hit" | "miss";
  checkedAt: string;
  elapsedMs: number;
  warnings: string[];
  decoder: string;
}
export interface Generation {
  id: string;
  runId: string;
  anchor: Entity;
  requested: Medium | "auto";
  firstMedium: Medium;
  medium: Medium;
  locked: boolean;
  lessObvious: boolean;
  pool: Entity[];
  discovery: Evidence;
  ranking?: Evidence;
  personalRankingApplied?: boolean;
  connections?: Record<string, string>;
  inherited?: boolean;
  warnings: string[];
  checkedAt: string;
}
export interface Step {
  entity: Entity;
  anchor: Entity;
  generation: Generation;
  selectedAt: string;
}
export interface Revision {
  id: string;
  parent?: string;
  root: Entity;
  steps: Step[];
  generations: Generation[];
  status: "draft" | "active" | "complete";
  createdAt: string;
}
export interface Counters {
  runs: number;
  insights: number;
  attempts: number;
  searches: number;
}
export interface Trail {
  id: string;
  owner: string;
  mode: Mode;
  version: number;
  root: Entity;
  status: "draft" | "active" | "complete";
  revision: string;
  history: Revision[];
  steps: Step[];
  generations: Generation[];
  current?: Generation;
  loves: Entity[];
  saved: Entity[];
  excluded: { entity: Entity; reason: "known" | "reject" }[];
  shown: string[];
  counters: Counters;
  createdAt: number;
  expiresAt: number;
  activeRun?: string;
  directionRequest?: Medium;
  lessObvious?: boolean;
  undo?: { kind: "path" | "reaction"; snapshot: string };
  pathUndo?: { kind: "path"; snapshot: string };
  reactionUndo?: { kind: "reaction"; snapshot: string };
  message?: string;
  idempotency: Record<string, { version: number; action: string }>;
}
export interface PublicTrail {
  note?: string;
  mode: Mode;
  root: Entity;
  steps: Step[];
  createdAt: number;
  expiresAt: number;
}
export interface Share {
  id: string;
  owner: string;
  trailId: string;
  version: number;
  tokenHash: string;
  ciphertext: string;
  snapshot: PublicTrail;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
}
export type RunState =
  | "reserved"
  | "running"
  | "committed"
  | "failed"
  | "cancelled"
  | "expired"
  | "unsaved";
export interface RunEvent {
  sequence: number;
  runId: string;
  type: "status" | "complete" | "error";
  message: string;
  at: number;
}
export interface Run {
  id: string;
  owner: string;
  trailId: string;
  expectedVersion: number;
  key: string;
  state: RunState;
  events: RunEvent[];
  createdAt: number;
  leaseUntil: number;
  expiresAt: number;
  attempts: number;
  insights: number;
  modelSteps: number;
  elapsedMs: number;
  reserved: number;
  settled: boolean;
  day: string;
  generation?: Generation;
  committedGenerationId?: string;
  telemetry?: {
    model: string;
    promptVersion: string;
    decoderVersion: string;
    priceContract: string;
    inputRate?: number;
    outputRate?: number;
    inputTokens?: number;
    outputTokens?: number;
    actualMicrodollars?: number;
    costStatus: "reserved" | "settled" | "unknown";
    cache?: "hit" | "miss";
  };
  error?: string;
  retryAt?: number;
}
export interface Session {
  idHash: string;
  createdAt: number;
  expiresAt: number;
  current?: string;
  previous?: string;
  identities: Entity[];
  cancelledRuns?: string[];
}
export interface Database {
  schema: 1;
  revision: number;
  sessions: Record<string, Session>;
  trails: Record<string, Trail>;
  shares: Record<string, Share>;
  runs: Record<string, Run>;
  windows: Record<string, number[]>;
  budgets: { cumulative: number; daily: Record<string, number> };
  qloo: Record<string, number>;
  qlooLeases: Record<string, number>;
  circuitUntil: number;
  votes: Record<
    string,
    {
      choice: string;
      caseVersion?: string;
      at: number;
      familiarity: string[];
      armOrder?: string[];
      expiresAt: number;
    }
  >;
  forks: Record<string, string>;
  deletions: Record<string, { owner: string; expiresAt: number }>;
}
export type OwnerTrail = Omit<
  Trail,
  "owner" | "undo" | "pathUndo" | "reactionUndo" | "idempotency" | "history"
> & {
  canUndo: boolean;
  sharedVersions: {
    id: string;
    version: number;
    createdAt: number;
    root: string;
  }[];
};
export function defaultMedium(root: Entity, steps: Step[]): Medium {
  const anchor = steps.at(-1)?.entity ?? root;
  const cycle: Record<Medium, Medium> = {
    movie: "artist",
    artist: "book",
    book: "movie",
  };
  const used = new Set([root.medium, ...steps.map((s) => s.entity.medium)]);
  return (
    [cycle[anchor.medium], cycle[cycle[anchor.medium]]].find(
      (m) => !used.has(m),
    ) ?? cycle[anchor.medium]
  );
}
export function visibleDoors(
  trail: Pick<Trail, "current" | "excluded" | "steps" | "root">,
): Entity[] {
  const omitted = new Set([
    trail.root.id,
    ...trail.steps.map((s) => s.entity.id),
    ...trail.excluded.map((e) => e.entity.id),
  ]);
  return (trail.current?.pool ?? [])
    .filter((e) => !omitted.has(e.id))
    .slice(0, 3);
}
