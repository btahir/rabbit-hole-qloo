import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteLoading } from "../../src/components/route-loading";
import ErrorBoundary from "../../src/app/error";
process.stdout.write(
  renderToStaticMarkup(
    process.argv[2] === "application-error"
      ? createElement(ErrorBoundary, { reset: () => {} })
      : createElement(RouteLoading),
  ),
);
