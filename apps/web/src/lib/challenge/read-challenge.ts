import type { IssuedChallenge } from "@hexmark/shared";
import { isRecord } from "@/lib/api-fields";

// A challenge or setup ticket in an API answer ({ token, expiresAt }), for
// the challenge cookie only.
export function readChallenge(value: unknown): IssuedChallenge | undefined {
  if (!isRecord(value)) return undefined;
  const { token, expiresAt } = value;
  if (typeof token !== "string" || typeof expiresAt !== "string") return undefined;
  return { token, expiresAt };
}
