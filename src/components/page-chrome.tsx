"use client";
import Link from "next/link";
import { useState } from "react";
import { comparisonReturnKey } from "./comparison-return";
import { BrandMark } from "./entity-art";
import { Button } from "./ui/button";
import { Drawer } from "./ui/drawer";
export function PageHeader() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav aria-label="Main">
        <Link prefetch={false} className="brand" href="/">
          <BrandMark />
          Rabbit Hole
        </Link>
        <span className="nav-note">
          Film <span>—</span> Music <span>—</span> Books
        </span>
        <Button onClick={() => setOpen(true)}>How it works</Button>
      </nav>
      <Drawer title="How it works" open={open} onClose={() => setOpen(false)}>
        <p>
          Start with something you love. Follow three discoveries across films,
          music and books. Keep the trail, or send its link to a friend.
        </p>
        <p>
          Qloo finds connections across people’s tastes. Your guide explores a
          new medium, then checks the choices against favourites you explicitly
          saved. Adding a discovery to your trail means you’re curious, not that
          you endorse it.
        </p>
      </Drawer>
    </>
  );
}
export function PageFooter() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <footer>
        <Link prefetch={false} href="/privacy">
          Privacy
        </Link>
        <Button onClick={() => setOpen(true)}>Sources</Button>
      </footer>
      <Drawer title="Sources" open={open} onClose={() => setOpen(false)}>
        <p>
          Connections come from Qloo. Titles and descriptions use the source
          shown on each discovery. A connection does not mean one work
          influenced another.
        </p>
        <p>
          Example trails and comparison cases are labelled individually.
          Illustrative connections are not live Qloo results.
        </p>
        <Link
          href="https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide"
          target="_blank"
          rel="noreferrer"
        >
          Qloo API
        </Link>
        <br />
        <Link
          href="https://docs.qloo.com/docs/interpreting-affinity-scores"
          target="_blank"
          rel="noreferrer"
        >
          How connections work
        </Link>
        <Link
          prefetch={false}
          href="/compare"
          onClick={() => {
            if (/^\/t\/[\w-]{8,100}$/.test(location.pathname))
              sessionStorage.setItem(
                comparisonReturnKey,
                JSON.stringify({
                  path: location.pathname,
                  scroll: window.scrollY,
                }),
              );
          }}
        >
          Qloo ordering audit
        </Link>
      </Drawer>
    </>
  );
}
