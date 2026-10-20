import { PageHeader, PageFooter } from "@/components/page-chrome";
import { RouteLoading } from "@/components/route-loading";
import { ShareRecovery } from "@/components/share-recovery";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Visitor } from "@/components/visitor";
import type { Metadata } from "next";
import { sharedTrail } from "@/lib/core/share-page";
import { AppError, errorCopy } from "@/lib/core/errors";
async function Content({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[\w-]{32}$/.test(token)) notFound();
  let snapshot;
  try {
    snapshot = await sharedTrail(token);
  } catch (error) {
    if (error instanceof AppError && error.code === "missing") notFound();
    return (
      <>
        <PageHeader />
        <ShareRecovery
          path={`/s/${token}`}
          failure={
            error instanceof AppError && error.code === "limit"
              ? {
                  error: error.code,
                  heading: errorCopy.limit[0],
                  body: errorCopy.limit[1],
                  retryAt: error.retryAt,
                }
              : {
                  error: "storage",
                  heading: "We couldn't open this trail just now.",
                  body: "Try again in a moment.",
                }
          }
        />
        <PageFooter />
      </>
    );
  }
  return <Visitor snapshot={snapshot} token={token} />;
}
export default function SharePage(props: {
  params: Promise<{ token: string }>;
}) {
  return (
    <Suspense fallback={<RouteLoading message="Opening the trail…" />}>
      <Content {...props} />
    </Suspense>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  try {
    const snapshot = await sharedTrail((await params).token);
    const path = [snapshot.root, ...snapshot.steps.map((s) => s.entity)];
    const title = `${snapshot.root.name} → ${path.at(-1)!.name} | Rabbit Hole`;
    const description = `${path.map((e) => e.name).join(" → ")}. Keep the beginning. Choose your own ending.`;
    return {
      title,
      description,
      openGraph: { title, description, type: "website" },
      twitter: { card: "summary_large_image", title, description },
    };
  } catch {
    return { title: "This trail isn't available | Rabbit Hole" };
  }
}
