import { RouteLoading } from "@/components/route-loading";
import { Suspense } from "react";
import { Workspace } from "@/components/workspace";
import { ownerPage } from "@/lib/core/page-data";
import { activatedSamples } from "@/lib/core/activated-samples";
import { configuredMode } from "@/lib/core/fixtures";
async function Content({ params }: { params: Promise<{ trailId: string }> }) {
  const { trailId } = await params;
  const result = await ownerPage(trailId);
  return (
    <Workspace
      key={trailId}
      mode={configuredMode()}
      liveSamples={configuredMode() === "live" ? await activatedSamples() : []}
      localGuide={!process.env.ANTHROPIC_API_KEY}
      initial={result.trail}
      initialError={result.error}
    />
  );
}
export default function TrailPage(props: {
  params: Promise<{ trailId: string }>;
}) {
  return (
    <Suspense fallback={<RouteLoading message="Opening your trail…" />}>
      <Content {...props} />
    </Suspense>
  );
}
