import "server-only";
import { assert } from "./errors";
import { modelBound } from "./limits";
import type { LanguageModelUsage } from "ai";
// Verified against Anthropic's Haiku 5.5 pricing, 19 October 2026.
// Requests are bounded below 100k tokens; the input ceiling includes cache writes.
export const MODEL = "claude-haiku-5-5";
export const INPUT_RATE = 0.125;
export const OUTPUT_RATE = 0.5;
export async function verifiedModelConfig() {
  const model = process.env.ANTHROPIC_MODEL || MODEL;
  assert(model === MODEL, "configuration", 503);
  modelBound(INPUT_RATE, OUTPUT_RATE);
  return { model, input: INPUT_RATE, output: OUTPUT_RATE };
}
/** Sum each step once. Unknown usage keeps the full reservation. */
export function billedMicrodollars(
  steps: { usage?: LanguageModelUsage }[],
): number | undefined {
  if (!steps.length) return;
  let total = 0;
  for (const { usage } of steps) {
    if (usage?.inputTokens === undefined || usage.outputTokens === undefined)
      return;
    const { noCacheTokens, cacheReadTokens, cacheWriteTokens } =
      usage.inputTokenDetails;
    const input = noCacheTokens ?? usage.inputTokens;
    const read = cacheReadTokens ?? 0;
    const write = cacheWriteTokens ?? 0;
    if (
      ![input, read, write, usage.outputTokens].every(
        (n) => Number.isFinite(n) && n >= 0,
      )
    )
      return;
    total +=
      input * 0.1 +
      read * 0.01 +
      write * INPUT_RATE +
      usage.outputTokens * OUTPUT_RATE;
  }
  return Math.ceil(total);
}
