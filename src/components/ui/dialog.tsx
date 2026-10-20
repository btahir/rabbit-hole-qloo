"use client";
import { Dialog } from "@base-ui/react/dialog";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "./button";
export function Drawer({
  title,
  open,
  onClose,
  children,
  returnFocus,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  returnFocus?: () => HTMLElement | null;
}) {
  const [opener] = useState(() =>
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement | null),
  );
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup
          className="dialog-popup"
          initialFocus={titleRef}
          finalFocus={() => {
            const target = returnFocus?.() ?? opener;
            return target?.isConnected && target.getClientRects().length
              ? target
              : ([
                  ...document.querySelectorAll<HTMLElement>(
                    "main h1, main h2, .brand",
                  ),
                ].find((el) => el.getClientRects().length > 0) ?? false);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const popup = event.currentTarget;
            const controls = [
              ...popup.querySelectorAll<HTMLElement>(
                'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
              ),
            ].filter(
              (element) =>
                element.getClientRects().length &&
                element.getAttribute("aria-hidden") !== "true",
            );
            const first = controls[0],
              last = controls.at(-1);
            if (!first) {
              event.preventDefault();
              titleRef.current?.focus();
              return;
            }
            const focused = document.activeElement;
            if (
              event.shiftKey &&
              (focused === first ||
                focused === titleRef.current ||
                focused === popup)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && focused === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <div className="dialog-header">
            <Dialog.Title ref={titleRef} tabIndex={-1}>
              {title}
            </Dialog.Title>
            <Dialog.Close
              render={<Button className="dialog-dismiss" aria-label="Close" />}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                aria-hidden="true"
              >
                <path
                  d="m6 6 12 12M6 18 18 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </Dialog.Close>
          </div>
          <div className="dialog-body">
            {children}
            <Dialog.Close render={<Button className="dialog-return" />}>
              Back to the trail
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
