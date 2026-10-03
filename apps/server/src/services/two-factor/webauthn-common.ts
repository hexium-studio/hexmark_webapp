import type { WebauthnCredentialSummary, WebauthnResponseJson } from "@hexmark/shared";
import { eq } from "drizzle-orm";
import { type WebauthnConfig, webauthnConfig } from "../../config/webauthn";
import type { Transaction } from "../../db/client";
import { type WebauthnCredential, webauthnCredentials } from "../../db/schema";
import type { Failure } from "../../lib/outcome";
import { refuse } from "./refusals";

// Pieces shared by registering security keys and signing in with them.

export type EnabledWebauthn = Extract<WebauthnConfig, { enabled: true }>;

// The configuration when security keys are offered, else the refusal.
export function enabledWebauthn(): EnabledWebauthn | Failure {
  const config = webauthnConfig();
  return config.enabled ? config : refuse("webauthn_unavailable");
}

export function isWebauthnRefusal(value: EnabledWebauthn | Failure): value is Failure {
  return "ok" in value;
}

// The challenge the browser signed, read from the answer's clientDataJSON;
// null when it cannot be read. It only names the ceremony to check against:
// the WebAuthn library verifies it again together with the signature.
export function signedChallenge(response: WebauthnResponseJson): string | null {
  const data = response.response.clientDataJSON;
  if (typeof data !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    const challenge = (parsed as { challenge?: unknown }).challenge;
    return typeof challenge === "string" && /^[A-Za-z0-9_-]{16,255}$/.test(challenge)
      ? challenge
      : null;
  } catch {
    return null;
  }
}

const TRANSPORTS = new Set(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);

// Transport hints as reported by the browser, keeping known values only.
export function knownTransports(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const known = [...new Set(value.filter((entry) => TRANSPORTS.has(entry)))] as string[];
  return known.length > 0 ? known : null;
}

export function userKeys(tx: Transaction, userId: string): Promise<WebauthnCredential[]> {
  return tx
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId))
    .orderBy(webauthnCredentials.createdAt);
}

export function credentialSummary(row: WebauthnCredential): WebauthnCredentialSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    deviceType: row.deviceType,
    backedUp: row.backedUp,
  };
}

// Credential row ids are UUIDs; anything else cannot name one.
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
