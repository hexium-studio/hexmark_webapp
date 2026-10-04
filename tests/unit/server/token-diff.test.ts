import { describe, expect, it } from "vitest";
import {
  type TokenState,
  tokenDiff,
} from "../../../apps/server/src/services/api-tokens/token-diff";

// What token.updated records about a change of a token (token-diff.ts).

const A = { kind: "folder" as const, id: "a", path: "A" };
const N = { kind: "note" as const, id: "n", path: "A/Note" };

const allow: TokenState = {
  mode: "allow_list",
  basePermissions: null,
  expiresAt: null,
  entries: [
    { ...A, permissions: ["read"] },
    { ...N, permissions: ["edit"] },
  ],
};

describe("token diff", () => {
  it("is empty when nothing changed", () => {
    expect(tokenDiff(allow, allow)).toEqual({ changed: false });
  });

  it("lists entries added, removed and changed with permissions before and after", () => {
    const after: TokenState = {
      ...allow,
      entries: [
        { ...A, permissions: ["read", "edit"] },
        { kind: "folder", id: "b", path: "B", permissions: ["read"] },
      ],
    };
    expect(tokenDiff(allow, after)).toEqual({
      changed: true,
      addedEntries: [{ kind: "folder", id: "b", path: "B", permissions: ["read"] }],
      removedEntries: [{ ...N, permissions: ["edit"] }],
      changedEntries: [{ ...A, before: ["read"], after: ["read", "edit"] }],
    });
  });

  it("counts every entry as replaced when the mode changes", () => {
    const after: TokenState = {
      mode: "deny_list",
      basePermissions: ["read"],
      expiresAt: "2027-01-01T00:00:00.000Z",
      entries: [{ ...A, permissions: null }],
    };
    expect(tokenDiff(allow, after)).toEqual({
      changed: true,
      mode: { before: "allow_list", after: "deny_list" },
      basePermissions: { before: null, after: ["read"] },
      expiresAt: { before: null, after: "2027-01-01T00:00:00.000Z" },
      addedEntries: [{ ...A, permissions: null }],
      removedEntries: [
        { ...A, permissions: ["read"] },
        { ...N, permissions: ["edit"] },
      ],
    });
  });
});
