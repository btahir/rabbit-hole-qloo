"use client";
import { PageHeader, PageFooter } from "@/components/page-chrome";
import Link from "next/link";
export default function ErrorBoundary({ reset }: { reset: () => void }) {
  return (
    <>
      <PageHeader />
      <main id="main">
        <h1>Something went wrong.</h1>
        <p>Your last saved trail is still here.</p>
        <button className="button button-primary" onClick={reset}>
          Reload trail
        </button>{" "}
        <Link prefetch={false} href="/">
          Back to the start
        </Link>
      </main>
      <PageFooter />
    </>
  );
}
