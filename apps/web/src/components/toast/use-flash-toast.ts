"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { FLASH_COOKIE, FLASH_TOASTS, isFlashToastId } from "./flash";
import { toast } from "./toast-store";

// Reads the cookie, deletes it and returns its id (see flash.ts).
function takeFlashCookie(): string | undefined {
  const prefix = `${FLASH_COOKIE}=`;
  const entry = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  if (!entry) return undefined;
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing in older Safari and Firefox
  document.cookie = `${FLASH_COOKIE}=; path=/; max-age=0; samesite=lax`;
  return decodeURIComponent(entry.slice(prefix.length));
}

// Shows a toast queued by a server action (flash-server.ts). Runs on the
// first page load and after every client navigation, which is how a
// server-action redirect arrives; the cookie is set by then, because the
// browser stores it with the action's response.
export function useFlashToast() {
  const t = useTranslations("flash");
  const pathname = usePathname();

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on purpose on every navigation
  useEffect(() => {
    const id = takeFlashCookie();
    if (!id || !isFlashToastId(id)) return;
    toast[FLASH_TOASTS[id]]({ title: t(`${id}.title`), message: t(`${id}.message`) });
  }, [pathname]);
}
