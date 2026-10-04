import {
  createApiTokenInputSchema,
  fieldErrorsFromZod,
  NOTE_ENTRY_PERMISSIONS,
  tokenAccessProblems,
  updateApiTokenInputSchema,
} from "@hexmark/shared";
import { describe, expect, it } from "vitest";

// The token inputs shared by the server and the web app: the mode required,
// permissions sorted and deduplicated, entries, and the rules that depend on
// the mode (tokenAccessProblems).

type ZodErrorOf = Parameters<typeof fieldErrorsFromZod>[0];

function codes(
  schema: { safeParse: (value: unknown) => { success: boolean; error?: unknown } },
  value: unknown,
) {
  const parsed = schema.safeParse(value);
  return parsed.success ? null : fieldErrorsFromZod(parsed.error as ZodErrorOf);
}

describe("token inputs", () => {
  it("need a mode and sort and deduplicate permissions", () => {
    const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(
      createApiTokenInputSchema.parse({
        name: " agent ",
        mode: "allow_list",
        entries: [{ kind: "folder", id, permissions: ["edit", "read", "edit"] }],
      }),
    ).toEqual({
      name: "agent",
      mode: "allow_list",
      entries: [{ kind: "folder", id, permissions: ["read", "edit"] }],
      expiresAt: null,
    });
    expect(
      createApiTokenInputSchema.parse({
        name: "agent",
        mode: "deny_list",
        basePermissions: ["search", "read"],
      }),
    ).toEqual({
      name: "agent",
      mode: "deny_list",
      basePermissions: ["read", "search"],
      entries: [],
      expiresAt: null,
    });
  });

  it("refuse a missing mode, unknown permissions, bad entries and malformed expiry", () => {
    const deny = { name: "a", mode: "deny_list" };
    expect(codes(createApiTokenInputSchema, { name: "a" })).toMatchObject({
      mode: { code: "required" },
    });
    expect(codes(createApiTokenInputSchema, { ...deny, basePermissions: ["root"] })).toMatchObject({
      basePermissions: { code: "invalid_option" },
    });
    expect(
      codes(createApiTokenInputSchema, { ...deny, entries: [{ kind: "page", id: "x" }] }),
    ).toMatchObject({ entries: { code: "invalid_option" } });
    expect(
      codes(createApiTokenInputSchema, { ...deny, basePermissions: ["read"], expiresAt: "soon" }),
    ).toMatchObject({ expiresAt: { code: "invalid_format" } });
    expect(codes(updateApiTokenInputSchema, { mode: "both" })).toMatchObject({
      mode: { code: "invalid_option" },
    });
    expect(updateApiTokenInputSchema.parse({ expiresAt: null })).toEqual({ expiresAt: null });
    expect(updateApiTokenInputSchema.parse({})).toEqual({});
  });

  it("check the rules that depend on the mode", () => {
    const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const folder = { kind: "folder" as const, id };
    expect(tokenAccessProblems("deny_list", ["read"], [])).toBeNull();
    expect(tokenAccessProblems("deny_list", null, [])).toEqual({
      basePermissions: { code: "required" },
    });
    expect(tokenAccessProblems("allow_list", null, [])).toEqual({ entries: { code: "required" } });
    expect(
      tokenAccessProblems("allow_list", ["read"], [{ ...folder, permissions: ["read"] }]),
    ).toEqual({ basePermissions: { code: "invalid" } });
    expect(tokenAccessProblems("allow_list", null, [folder])).toEqual({
      entries: { code: "required", params: { index: 0 } },
    });
    expect(
      tokenAccessProblems("deny_list", ["read"], [{ ...folder, permissions: ["read"] }]),
    ).toEqual({ entries: { code: "invalid", params: { index: 0 } } });
    expect(
      tokenAccessProblems("deny_list", ["read"], [folder, { ...folder, id: id.toUpperCase() }]),
    ).toEqual({ entries: { code: "invalid", params: { index: 1 } } });
    const note = { kind: "note" as const, id };
    expect(
      tokenAccessProblems("allow_list", null, [{ ...note, permissions: ["read", "lock"] }]),
    ).toBeNull();
    for (const permission of ["create", "search"] as const) {
      expect(
        tokenAccessProblems("allow_list", null, [{ ...note, permissions: [permission] }]),
      ).toEqual({ entries: { code: "invalid_option", params: { index: 0 } } });
    }
    expect(NOTE_ENTRY_PERMISSIONS).toEqual(["read", "edit", "move", "delete", "lock", "hide"]);
  });
});
