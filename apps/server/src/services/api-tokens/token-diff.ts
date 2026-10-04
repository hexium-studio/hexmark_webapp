import type { ApiTokenAccessMode, ApiTokenInfo, NotePermission } from "@hexmark/shared";

// What changed on a token, for the audit log of token.updated: the mode,
// the base permissions, the expiry and the entries added, removed and
// changed (with their permissions before and after). A new mode replaces
// every entry, so all old ones count as removed and all new ones as added.
// Pure.

interface EntryFact {
  kind: "folder" | "note";
  id: string;
  path: string;
  permissions: NotePermission[] | null;
}

export interface TokenState {
  mode: ApiTokenAccessMode;
  basePermissions: NotePermission[] | null;
  expiresAt: string | null;
  entries: readonly EntryFact[];
}

export function tokenState(info: ApiTokenInfo): TokenState {
  return {
    mode: info.mode,
    basePermissions: info.basePermissions,
    expiresAt: info.expiresAt,
    entries: info.entries.map((entry) => ({
      kind: entry.kind,
      id: entry.targetId,
      path: entry.path,
      permissions: entry.permissions,
    })),
  };
}

const key = (entry: EntryFact) => `${entry.kind}:${entry.id}`;
const same = (a: readonly unknown[] | null, b: readonly unknown[] | null) =>
  JSON.stringify(a) === JSON.stringify(b);
const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);

export function tokenDiff(before: TokenState, after: TokenState) {
  const details: Record<string, unknown> = {};
  if (before.mode !== after.mode) details.mode = { before: before.mode, after: after.mode };
  if (!same(before.basePermissions, after.basePermissions)) {
    details.basePermissions = { before: before.basePermissions, after: after.basePermissions };
  }
  if (before.expiresAt !== after.expiresAt) {
    details.expiresAt = { before: before.expiresAt, after: after.expiresAt };
  }
  const replaced = before.mode !== after.mode;
  const old = new Map(before.entries.map((entry) => [key(entry), entry]));
  const now = new Map(after.entries.map((entry) => [key(entry), entry]));
  const added = after.entries.filter((entry) => replaced || !old.has(key(entry)));
  const removed = before.entries.filter((entry) => replaced || !now.has(key(entry)));
  const changed = replaced
    ? []
    : after.entries.flatMap((entry) => {
        const was = old.get(key(entry));
        return was && !same(was.permissions, entry.permissions)
          ? [
              {
                kind: entry.kind,
                id: entry.id,
                path: entry.path,
                before: was.permissions,
                after: entry.permissions,
              },
            ]
          : [];
      });
  if (added.length) details.addedEntries = [...added].sort(byPath);
  if (removed.length) details.removedEntries = [...removed].sort(byPath);
  if (changed.length) details.changedEntries = changed.sort(byPath);
  return { changed: Object.keys(details).length > 0, ...details };
}
