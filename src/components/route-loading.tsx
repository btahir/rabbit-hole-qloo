import { PageHeader, PageFooter } from "./page-chrome";
import { BrandMark } from "./entity-art";
export function RouteLoading({
  message = "Opening your trail…",
}: {
  message?: string;
}) {
  return (
    <>
      <PageHeader />
      <main id="main" className="route-loading">
        <BrandMark />
        <p role="status">{message}</p>
      </main>
      <PageFooter />
    </>
  );
}
