"use client";

import { useEffect } from "react";

// Sign-in and sign-out swap the whole page content in place (same URL, no
// navigation), which would leave keyboard focus on a removed element. The
// form asks for focus before its action starts, and the view that replaces
// it moves focus to its heading when it mounts. A first page load never
// asks, so there the skip link stays the first stop.

// The h1 of the sign-in card (all sign-in steps share it).
export const SIGN_IN_TITLE_ID = "sign-in-title";

let requested = false;

export function requestHeadingFocus(): void {
  requested = true;
}

// The action failed and the form stays.
export function cancelHeadingFocus(): void {
  requested = false;
}

// Rendered by the view that may replace the form; `targetId` is its h1
// (CardShell's titleId, which makes the heading focusable).
export function ClaimHeadingFocus({ targetId }: { targetId: string }) {
  useEffect(() => {
    if (!requested) return;
    requested = false;
    document.getElementById(targetId)?.focus();
  }, [targetId]);
  return null;
}
