import type {
  AccountSecurityResponse,
  TwoFactorOverview,
  WebauthnCredentialSummary,
} from "@hexmark/shared";
import { isRecord } from "@/lib/api-fields";

// The factors of an account as GET /api/account/v1/security and
// GET /api/setup/v1/two-factor/status report them, checked field by field.

function readCredential(value: unknown): WebauthnCredentialSummary | undefined {
  if (!isRecord(value)) return undefined;
  const { id, name, createdAt, lastUsedAt, deviceType, backedUp } = value;
  if (typeof id !== "string" || typeof name !== "string" || typeof createdAt !== "string") {
    return undefined;
  }
  if (lastUsedAt !== null && typeof lastUsedAt !== "string") return undefined;
  const type = deviceType === "singleDevice" || deviceType === "multiDevice" ? deviceType : null;
  return { id, name, createdAt, lastUsedAt, deviceType: type, backedUp: backedUp === true };
}

export function readTwoFactorOverview(value: unknown): TwoFactorOverview | undefined {
  if (!isRecord(value)) return undefined;
  const { totp, webauthn, recoveryCodes, requireTwoFactor } = value;
  if (!isRecord(totp) || !isRecord(webauthn) || !isRecord(recoveryCodes)) return undefined;
  if (!Array.isArray(webauthn.credentials) || typeof recoveryCodes.remaining !== "number") {
    return undefined;
  }
  const credentials = webauthn.credentials.map(readCredential);
  if (credentials.some((entry) => entry === undefined)) return undefined;
  return {
    totp: { enabled: totp.enabled === true },
    webauthn: {
      available: webauthn.available === true,
      credentials: credentials as WebauthnCredentialSummary[],
    },
    recoveryCodes: { remaining: recoveryCodes.remaining },
    requireTwoFactor: requireTwoFactor === true,
  };
}

export function readAccountSecurity(value: unknown): AccountSecurityResponse | undefined {
  const overview = readTwoFactorOverview(value);
  if (!overview || !isRecord(value)) return undefined;
  const { reauthenticatedUntil, timezone } = value;
  return {
    ...overview,
    reauthenticatedUntil: typeof reauthenticatedUntil === "string" ? reauthenticatedUntil : null,
    timezone: typeof timezone === "string" && timezone !== "" ? timezone : "UTC",
  };
}
