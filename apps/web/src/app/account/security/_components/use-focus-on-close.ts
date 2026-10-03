"use client";

import { useEffect, useRef } from "react";

// When `open` turns false (a set-up form closed: done or cancelled), the
// control that was pressed is gone; focus moves to the element with
// `targetId`, e.g. the section's heading.
export function useFocusOnClose(open: boolean, targetId: string): void {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open && wasOpen.current) document.getElementById(targetId)?.focus();
    wasOpen.current = open;
  }, [open, targetId]);
}
