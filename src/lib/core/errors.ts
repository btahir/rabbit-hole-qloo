export type ErrorCode =
  | "input"
  | "invalid_seed"
  | "owner"
  | "missing"
  | "storage"
  | "conflict"
  | "limit"
  | "paused"
  | "trail_limit"
  | "contract"
  | "qloo"
  | "configuration"
  | "model"
  | "timeout"
  | "cancelled"
  | "interrupted"
  | "unsaved";
export const errorCopy: Record<ErrorCode, [string, string]> = {
  input: ["Please check this choice and try again.", ""],
  invalid_seed: [
    "This starting point can't open new doors yet.",
    "Qloo couldn't use this catalog identity. Your trail is safe. Choose another starting point.",
  ],
  owner: [
    "This trail belongs to another session.",
    "Open a shared link, or start your own trail.",
  ],
  missing: [
    "This trail isn't available.",
    "The link may have expired or stopped being shared.",
  ],
  storage: [
    "We can't start a new step right now.",
    "Your open trail is safe. Please try again later.",
  ],
  conflict: [
    "This trail changed in another tab.",
    "Open the latest version to keep going.",
  ],
  limit: ["Let's pause for a moment.", "Try again after the time shown."],
  paused: [
    "New trails are paused for now.",
    "You can still open and share trails you've already made.",
  ],
  trail_limit: [
    "This trail has reached its limit.",
    "Keep it, or start a new one later.",
  ],
  contract: [
    "We couldn't check these connections.",
    "No new doors were added. Your trail is safe.",
  ],
  qloo: [
    "We couldn't find the next doors just now.",
    "Your trail is safe. Try again, or come back later.",
  ],
  configuration: [
    "Live connections aren't available right now.",
    "You can keep this trail or open a clearly labelled example.",
  ],
  model: [
    "The guide couldn't finish this step.",
    "Your trail is safe. Please try again.",
  ],
  timeout: [
    "This step took too long.",
    "Your trail is safe. Try again when you're ready.",
  ],
  cancelled: ["Stopped. Your trail is safe.", ""],
  interrupted: [
    "This step was interrupted. Your saved trail is safe.",
    "Try again",
  ],
  unsaved: [
    "These doors aren't saved yet.",
    "Keep this page open and try saving again.",
  ],
};
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public status = 400,
    public retryAt?: number,
  ) {
    super(errorCopy[code][0]);
  }
}
export function assert(
  condition: unknown,
  code: ErrorCode = "input",
  status = 400,
): asserts condition {
  if (!condition) throw new AppError(code, status);
}
