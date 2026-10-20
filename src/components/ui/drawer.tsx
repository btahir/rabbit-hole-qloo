"use client";
import type { ReactNode } from "react";
import { Drawer as DialogContent } from "./dialog";
/** The dialog shell ships with the readable workspace, including offline use. */
export function Drawer(props: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  returnFocus?: () => HTMLElement | null;
}) {
  return props.open ? <DialogContent {...props} /> : null;
}
