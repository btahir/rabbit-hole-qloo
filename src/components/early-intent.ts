/**
 * Clicks that land before React hydrates have no handler yet. This tiny inline
 * script (rendered in the root layout) records the first such click on an
 * element marked `data-early`, and the first submit of a `form[data-early]`,
 * so the hydrated component can carry it out instead of losing it.
 * `html[data-early-pending]` lets CSS show progress straight away.
 */
export const earlyIntentScript = `(function(){var d=document,h=d.documentElement;function k(e){if(window.__rhLive||window.__rhEarly)return;var t=e.target;if(!t||!t.closest)return;var el=e.type==="submit"?t.closest("form[data-early]"):t.closest("button[data-early]");if(!el||el.disabled)return;var v=el.getAttribute("data-early");var i={kind:v};if(e.type==="submit"){e.preventDefault();var q=el.querySelector("input"),s=el.querySelector("select");i.query=q?q.value:"";i.medium=s?s.value:"";}window.__rhEarly=i;h.setAttribute("data-early-pending",v);}d.addEventListener("click",k,true);d.addEventListener("submit",k,true);})();`;

export type EarlyIntent = { kind: string; query?: string; medium?: string };

declare global {
  interface Window {
    __rhLive?: boolean;
    __rhEarly?: EarlyIntent;
  }
}

/** Mark the page as hydrated and return any intent captured before it. */
export function takeEarlyIntent(): EarlyIntent | undefined {
  window.__rhLive = true;
  const intent = window.__rhEarly;
  window.__rhEarly = undefined;
  document.documentElement.removeAttribute("data-early-pending");
  return intent;
}
