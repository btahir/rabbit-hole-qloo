import { RouteLoading } from "@/components/route-loading";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { savedComparisons } from "@/lib/core/saved-comparisons";
import { ComparisonView } from "@/components/comparison-view";
async function Content({ params }: { params: Promise<{ caseId: string }> }) {
  await connection();
  const { caseId } = await params;
  const item = (await savedComparisons()).find((c) => c.id === caseId);
  if (!item) notFound();
  return <ComparisonView item={item} />;
}
export default function ComparisonPage(props: {
  params: Promise<{ caseId: string }>;
}) {
  return (
    <Suspense fallback={<RouteLoading message="Opening saved comparison…" />}>
      <Content {...props} />
    </Suspense>
  );
}
