"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export const comparisonReturnKey = "rabbit-comparison-return";
export function ReturnToTrail() {
  const [path, setPath] = useState("/");
  useEffect(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(comparisonReturnKey) ?? "null",
      );
      // Owner routes contain no read capabilities. Accept no external URLs.
      if (/^\/t\/[\w-]{8,100}$/.test(saved?.path)) {
        // Browser session state is restored only after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPath(saved.path);
      }
    } catch {
      /* Optional navigation context. */
    }
  }, []);
  return (
    <Link href={path} prefetch={false}>
      Back to the trail
    </Link>
  );
}
