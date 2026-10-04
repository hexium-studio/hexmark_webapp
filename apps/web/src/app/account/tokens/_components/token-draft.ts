import type { NotePermission } from "@hexmark/shared";

// What the create form sends to createApiToken (token-actions.ts).

// Offered expiry periods; null: never expires.
export const EXPIRY_DAYS = [30, 90, 365] as const;
export type ExpiryDays = (typeof EXPIRY_DAYS)[number] | null;

export interface TokenDraft {
  name: string;
  permissions: NotePermission[];
  // Null: the whole wiki.
  folderScope: string[] | null;
  expiryDays: ExpiryDays;
}
