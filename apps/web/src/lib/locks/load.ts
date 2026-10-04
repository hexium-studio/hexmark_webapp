import type { HiddenItem, LockedItem } from "@hexmark/shared";
import { isRecord } from "@/lib/api-fields";
import { callServer } from "@/lib/server-api";
import { sessionAuthorization } from "@/lib/session/session-authorization";
import { loadAccountSecurity } from "@/lib/two-factor/account-security";

// What /locked shows, for the signed-in user of the current request: the
// notes and folders with a lock of their own (GET /api/notes/v1/locked),
// those hidden themselves (GET /api/notes/v1/hidden), the account's time
// zone and until when its last password confirmation counts. Server code
// only.

export interface LockedPageData {
  items: LockedItem[];
  hidden: HiddenItem[];
  timezone: string;
  reauthenticatedUntil: string | null;
}

export type LockedPageResult =
  | { kind: "ok"; data: LockedPageData }
  | { kind: "unauthenticated" }
  | { kind: "unavailable" };

const isString = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number => Number.isInteger(value);

// One listed item, checked field by field; undefined when malformed. Pure.
export function readLockedItem(value: unknown): LockedItem | undefined {
  if (!isRecord(value)) return undefined;
  const { kind, id, path, lockedAt, lockedBy, reason, coveredFolders, coveredNotes } = value;
  if (kind !== "note" && kind !== "folder") return undefined;
  if (![id, path, lockedAt, lockedBy].every(isString)) return undefined;
  if (reason !== null && !isString(reason)) return undefined;
  if (!isCount(coveredFolders) || !isCount(coveredNotes)) return undefined;
  return {
    kind,
    id: id as string,
    path: path as string,
    lockedAt: lockedAt as string,
    lockedBy: lockedBy as string,
    reason,
    coveredFolders,
    coveredNotes,
  };
}

// A hidden item, checked field by field; undefined when malformed. Pure.
export function readHiddenItem(value: unknown): HiddenItem | undefined {
  if (!isRecord(value)) return undefined;
  const { kind, id, path, hiddenAt, hiddenBy, reason, coveredFolders, coveredNotes } = value;
  if (kind !== "note" && kind !== "folder") return undefined;
  if (![id, path, hiddenAt, hiddenBy].every(isString)) return undefined;
  if (reason !== null && !isString(reason)) return undefined;
  if (!isCount(coveredFolders) || !isCount(coveredNotes)) return undefined;
  return {
    kind,
    id: id as string,
    path: path as string,
    hiddenAt: hiddenAt as string,
    hiddenBy: hiddenBy as string,
    reason,
    coveredFolders,
    coveredNotes,
  };
}

// The items of a list answer, each read by `read`; null when the answer or
// any item is malformed.
function readItems<T>(body: unknown, read: (value: unknown) => T | undefined): T[] | null {
  const raw = isRecord(body) && Array.isArray(body.items) ? body.items : null;
  const items = raw?.map(read);
  return items && !items.some((item) => item === undefined) ? (items as T[]) : null;
}

export async function loadLockedPage(): Promise<LockedPageResult> {
  const authorization = await sessionAuthorization();
  if (!authorization) return { kind: "unauthenticated" };
  const [list, hiddenList, security] = await Promise.all([
    callServer("/api/notes/v1/locked", { headers: { authorization } }),
    callServer("/api/notes/v1/hidden", { headers: { authorization } }),
    loadAccountSecurity(),
  ]);
  if (!list.reachable || !hiddenList.reachable) return { kind: "unavailable" };
  if (list.status === 401 || hiddenList.status === 401 || security.kind === "unauthenticated")
    return { kind: "unauthenticated" };
  if (list.status !== 200 || hiddenList.status !== 200 || security.kind !== "ok")
    return { kind: "unavailable" };
  const items = readItems(list.body, readLockedItem);
  const hidden = readItems(hiddenList.body, readHiddenItem);
  if (!items || !hidden) return { kind: "unavailable" };
  const { timezone, reauthenticatedUntil } = security.security;
  return { kind: "ok", data: { items, hidden, timezone, reauthenticatedUntil } };
}
