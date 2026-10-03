import type { ToastType } from "./toast-store";

// Toasts that a server action queues before it redirects ("flash" toasts).
// A redirect from a server action replaces the page before any client code
// of the action's caller runs again, so the toast travels in a short-lived
// cookie instead: the action sets it (flash-server.ts), the Toaster in the
// root layout reads and deletes it on the next page (use-flash-toast.ts).
// The cookie holds only one of the ids below, never text: the browser
// translates it into the language of the page it lands on, and a forged
// value can at most show one of these toasts.
// Texts are the messages "flash.<id>.title" and "flash.<id>.message".

export const FLASH_COOKIE = "hexmark_flash";

export const FLASH_TOASTS = {
  adminCreated: "success",
  setupSaved: "success",
} as const satisfies Record<string, ToastType>;

export type FlashToastId = keyof typeof FLASH_TOASTS;

export function isFlashToastId(value: string): value is FlashToastId {
  return Object.hasOwn(FLASH_TOASTS, value);
}
