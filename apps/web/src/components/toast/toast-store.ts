// Toast notifications for feedback that does not belong to a single field
// (~/Projects/UI-Richtlinien, section 1). Field errors stay at the field.
//
//   import { toast } from "@/components/toast/toast-store";
//   toast.error({ title: t("..."), message: t("..."), action: { label, onClick } });
//
// Callable from any client component or event handler; the <Toaster> in the
// root layout renders whatever is in this store, so a toast survives client
// navigation, router.refresh() and redirects. To show a toast after a server
// action redirects, queue it there instead (flash-server.ts).
// Titles and messages are passed already translated.

export type ToastType = "success" | "info" | "warning" | "error";

// How long each type stays (UI-Richtlinien). The progress bar runs over
// exactly this time and pauses on hover and focus (Toast.module.css).
export const TOAST_DURATION_MS: Record<ToastType, number> = {
  success: 3_000,
  info: 5_000,
  warning: 7_000,
  error: 10_000,
};

export interface ToastAction {
  label: string;
  // The toast closes after the action ran.
  onClick(): void;
}

export interface ToastOptions {
  title: string;
  message?: string;
  action?: ToastAction;
}

export interface ToastEntry extends ToastOptions {
  id: number;
  type: ToastType;
  // How often the same message was shown in a row; shown as a counter.
  count: number;
}

// More can never fit on a screen; the Toaster drops what does not fit anyway.
const MAX_ENTRIES = 10;
const NO_ENTRIES: readonly ToastEntry[] = [];

// Newest first, which is also the order on screen (newest on top).
let entries: readonly ToastEntry[] = NO_ENTRIES;
let lastId = 0;
const listeners = new Set<() => void>();

function publish(next: readonly ToastEntry[]) {
  entries = next;
  for (const listener of listeners) listener();
}

function show(type: ToastType, options: ToastOptions): number {
  const newest = entries[0];
  // The same message again: count it on the newest toast and restart its
  // time instead of stacking a copy (the bar is keyed by `count`).
  if (
    newest &&
    newest.type === type &&
    newest.title === options.title &&
    newest.message === options.message
  ) {
    publish([{ ...newest, action: options.action, count: newest.count + 1 }, ...entries.slice(1)]);
    return newest.id;
  }
  lastId += 1;
  publish([{ ...options, id: lastId, type, count: 1 }, ...entries].slice(0, MAX_ENTRIES));
  return lastId;
}

export function dismissToast(id: number) {
  if (entries.some((entry) => entry.id === id)) {
    publish(entries.filter((entry) => entry.id !== id));
  }
}

export const toast = {
  success: (options: ToastOptions) => show("success", options),
  info: (options: ToastOptions) => show("info", options),
  warning: (options: ToastOptions) => show("warning", options),
  error: (options: ToastOptions) => show("error", options),
  dismiss: dismissToast,
};

// For useSyncExternalStore in the Toaster.
export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): readonly ToastEntry[] {
  return entries;
}

// The server never has toasts; they only come from browser events.
export function getServerToasts(): readonly ToastEntry[] {
  return NO_ENTRIES;
}
