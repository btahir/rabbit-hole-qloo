import { ReturnToTrail } from "@/components/comparison-return";
import { RouteLoading } from "@/components/route-loading";
import { PageHeader, PageFooter } from "@/components/page-chrome";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { savedComparisons } from "@/lib/core/saved-comparisons";
async function Content() {
  await connection();
  const comparisons = await savedComparisons();
  const illustrative = comparisons.every((c) => c.source === "synthetic");
  return (
    <>
      <PageHeader />
      <main id="main">
        <h1>Five saved comparisons</h1>
        <p>
          Which version has something unfamiliar you would actually open?
          Explore the same starting point with and without Qloo taste
          connections.
        </p>
        <p className="notice">
          {illustrative
            ? "Example mode. These are illustrative sets, not live Qloo results. Live comparisons have not run. No winner has been measured."
            : "Saved ordering audits, including ties, omissions and failures. The authored-order baseline ignores the starting point. These are not a same-model comparison or evidence of user benefit."}
        </p>
        <ol>
          {comparisons.map((c) => (
            <li key={c.id}>
              <Link href={`/compare/${c.id}`} prefetch={false}>
                {c.title}
              </Link>{" "}
              ·{" "}
              {c.source === "synthetic"
                ? "Illustrative"
                : c.arms.some((a) => a.status === "failed")
                  ? "Includes a failed version"
                  : "Saved live results"}{" "}
              · frozen {c.frozenAt.slice(0, 10)}
            </li>
          ))}
        </ol>
        <details>
          <summary>Comparison protocol</summary>
          <p>
            The authored catalog contains 12 film, 12 artist and 12 book
            identities. It was authored before observing any Qloo output. Live
            execution confirms identifiers and freezes common eligibility. The
            saved local comparison uses the same deterministic selector in both
            arms; a language-model evaluation remains pending. A baseline must
            receive no Insights scores or retrieved shortlist. Keep omissions,
            empty results and failures. Blind the order, freeze familiarity and
            choice before reveal, and report ties and exact counts separately
            from public exploratory votes.
          </p>
          <p>No paid call occurs on page view.</p>
        </details>
        <ReturnToTrail />
      </main>
      <PageFooter />
    </>
  );
}
export default function ComparisonIndex() {
  return (
    <Suspense fallback={<RouteLoading message="Opening saved comparisons…" />}>
      <Content />
    </Suspense>
  );
}
