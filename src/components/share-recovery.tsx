"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Failure } from "./use-trail";
import { Button } from "./ui/button";

export function ShareRecovery({
  failure,
  path,
}: {
  failure: Failure;
  path: string;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!failure.retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [failure.retryAt]);
  return (
    <main id="main">
      <h1>{failure.heading}</h1>
      <p>{failure.body}</p>
      {failure.retryAt ? (
        <p>
          Try again after{" "}
          {new Date(failure.retryAt).toLocaleString(undefined, {
            timeZoneName: "short",
          })}
          .
        </p>
      ) : null}
      <div className="actions">
        {failure.retryAt && now < failure.retryAt ? (
          <Button disabled>Try again</Button>
        ) : (
          <Link prefetch={false} href={path}>
            Try again
          </Link>
        )}
        <Link prefetch={false} href="/">
          Back to the start
        </Link>
      </div>
    </main>
  );
}
