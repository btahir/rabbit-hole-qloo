import { PageHeader, PageFooter } from "@/components/page-chrome";
import Link from "next/link";
export default function NotFound() {
  return (
    <>
      <PageHeader />
      <main id="main">
        <h1>This trail isn&apos;t available.</h1>
        <p>The link may have expired or stopped being shared.</p>
        <Link prefetch={false} href="/">
          Start a trail
        </Link>{" "}
        ·{" "}
        <Link prefetch={false} href="/#examples">
          Try an example
        </Link>
      </main>
      <PageFooter />
    </>
  );
}
