import type { FactorFailure } from "@/lib/two-factor/factor-result";
import { regenerateRecoveryCodes, removeAuthenticator, removeSecurityKey } from "./account-actions";

// The account changes that need the password re-entered within the last
// 10 minutes (contract: apps/server/src/api/account/v1/index.ts, marked
// (R)); the confirmation dialog asks for it when it is due.

export type SensitiveRequest =
  | { kind: "removeTotp"; removesLast: boolean }
  | { kind: "removeKey"; id: string; name: string; removesLast: boolean }
  | { kind: "regenerate" };

export type SensitiveResult = { ok: true; recoveryCodes?: string[] } | FactorFailure;

export function performSensitive(request: SensitiveRequest): Promise<SensitiveResult> {
  switch (request.kind) {
    case "removeTotp":
      return removeAuthenticator();
    case "removeKey":
      return removeSecurityKey(request.id);
    case "regenerate":
      return regenerateRecoveryCodes();
  }
}
