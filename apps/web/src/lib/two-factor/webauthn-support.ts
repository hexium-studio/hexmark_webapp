"use client";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useSyncExternalStore } from "react";

// Whether this page can use security keys: the server offers them (its
// PUBLIC_ORIGIN is set, reported as `offered`), the page runs in a secure
// context (https, or localhost) and the browser has WebAuthn.
//
//   "usable"   – offer security keys;
//   "server"   – the server does not offer them;
//   "browser"  – the server does, but this browser or connection cannot.
// The server render knows nothing about the browser and says "browser"
// until hydration; callers keep the room of both versions, so nothing moves
// when the answer changes (see components/two-factor/KeySupportSlot.tsx).

export type WebauthnSupport = "usable" | "server" | "browser";

const noSubscription = () => () => {};

function browserCanUseWebauthn(): boolean {
  return window.isSecureContext && browserSupportsWebAuthn();
}

export function useWebauthnSupport(offered: boolean): WebauthnSupport {
  const browser = useSyncExternalStore(noSubscription, browserCanUseWebauthn, () => false);
  if (!offered) return "server";
  return browser ? "usable" : "browser";
}
