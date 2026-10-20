import { vi } from "vitest";
// Tests can never inherit a paid provider credential from the invoking shell.
vi.stubEnv("QLOO_API_KEY", "");
vi.stubEnv("ANTHROPIC_API_KEY", "");
