import type { AccountSecurityResponse, FactorCounts } from "@hexmark/shared";
import type { FactorFailure } from "@/lib/two-factor/factor-result";
import type { SensitiveRequest } from "./sensitive";

// What every section of the security page gets from SecurityPage.
export interface SectionProps {
  security: AccountSecurityResponse;
  counts: FactorCounts;
}

export interface FactorSectionProps extends SectionProps {
  onAdded(kind: "app" | "key", recoveryCodes: string[] | null): void;
  onRemove(request: SensitiveRequest): void;
}

// A session that ended while the page was open: reloading leads to sign-in.
export function sessionEnded(failure: FactorFailure, reload: () => void): boolean {
  if (failure.error !== "unauthenticated") return false;
  reload();
  return true;
}
