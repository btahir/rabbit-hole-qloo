import { PageHeader, PageFooter } from "@/components/page-chrome";
import Link from "next/link";
export default function Privacy() {
  return (
    <>
      <PageHeader />
      <main id="main">
        <h1>Retention and provider details</h1>
        <p>
          No account is required. The signed HttpOnly session cookie grants
          owner access for 30 days. Losing it loses editing access. Trails,
          evidence and unlisted snapshots expire after 30 days; reading a link
          does not extend its expiry. Owner deletion removes the trail, runs and
          shares, while independently retained forks remain.
        </p>
        <p>
          Private ShipTiffin Valkey stores server state, private caches, usage
          reservations and limits when configured. Local development falls back
          to process memory, which resets on restart. Only synthetic examples
          may be stored in browser session storage. Search confirmation
          candidates are private and are never shared.
        </p>
        <p>
          Live searches and cultural references are processed by Qloo. When
          configured, generation uses Anthropic directly (Claude Haiku 5.5).
          Otherwise a deterministic guide uses Qloo without sending data to a
          language model. The steps drawer identifies which guide ran. Example
          mode never calls Qloo or an AI provider. Live artwork loads from Qloo
          without a page referrer.
        </p>
        <p>
          Qloo caches expire after one hour for identities/search and five
          minutes for Insights; valid empty collections last at most 30 seconds.
          Product snapshots retain normalized selected evidence until their own
          expiry. Reusable responses stay in private server caches for those
          short windows. An explicitly enabled local development disk cache
          retains responses for up to seven days; it is disabled on production
          hosting. Shared trails contain only selected, normalized evidence. We
          do not use third-party analytics. Nonidentifying usage/budget totals
          may remain after deletion.
        </p>
        <p>
          If saving fails, this open page can hold an encrypted copy of the
          result. You can use it to retry saving for up to 20 minutes.
        </p>
        <p>
          <Link
            prefetch={false}
            href="https://www.qloo.com/legal/privacy-policy"
            rel="noreferrer"
          >
            Qloo privacy
          </Link>{" "}
          ·{" "}
          <Link
            prefetch={false}
            href="https://www.anthropic.com/legal/privacy"
            rel="noreferrer"
          >
            Anthropic privacy
          </Link>{" "}
        </p>
        <Link prefetch={false} href="/">
          Back to the start
        </Link>
      </main>
      <PageFooter />
    </>
  );
}
