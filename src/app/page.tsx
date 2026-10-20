import { PageHeader, PageFooter } from "@/components/page-chrome";
import { Suspense } from "react";
import { connection } from "next/server";
import { Workspace } from "@/components/workspace";
import { activatedSamples } from "@/lib/core/activated-samples";
import { configuredMode } from "@/lib/core/fixtures";
async function Content() {
  await connection();
  const mode = configuredMode();
  return (
    <Workspace
      mode={mode}
      localGuide={!process.env.ANTHROPIC_API_KEY}
      liveSamples={mode === "live" ? await activatedSamples() : []}
    />
  );
}
export default function Home() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader />
          <main id="main">
            <h1>What do you love?</h1>
            <p>Pick a film, musician or book.</p>
          </main>
          <PageFooter />
        </>
      }
    >
      <Content />
    </Suspense>
  );
}
