import {
  createNoteInputSchema,
  fieldErrorsFromZod,
  folderNameSchema,
  mcpServersConfig,
  mcpToolInputs,
  NOTE_BODY_MAX_BYTES,
  noteTitleSchema,
  noteViewQuerySchema,
  replaceSectionInputSchema,
  restoreNoteInputSchema,
  TRASH_RETENTION_DAYS,
  trashQuerySchema,
  updateNoteInputSchema,
} from "@hexmark/shared";
import { describe, expect, it } from "vitest";

// The shared input rules for notes, folders, tokens and MCP tools.

type ZodErrorOf = Parameters<typeof fieldErrorsFromZod>[0];

function codes(
  schema: { safeParse: (value: unknown) => { success: boolean; error?: unknown } },
  value: unknown,
) {
  const parsed = schema.safeParse(value);
  return parsed.success ? null : fieldErrorsFromZod(parsed.error as ZodErrorOf);
}

describe("titles and folder names", () => {
  it("are trimmed and may not be blank or contain / or control characters", () => {
    expect(noteTitleSchema.parse("  Plan  ")).toBe("Plan");
    expect(noteTitleSchema.parse("Ünïcode 😀 & more")).toBe("Ünïcode 😀 & more");
    for (const bad of ["", "   ", "a/b", "/", "tab\there", "line\nbreak", "\u007f"]) {
      expect(noteTitleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      expect(folderNameSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(codes(createNoteInputSchema, { title: "a/b", body: "" })).toEqual({
      title: { code: "invalid_format" },
    });
    // Blank is "empty", missing is "required": a client can tell them apart.
    expect(codes(createNoteInputSchema, { title: "  ", body: "" })).toEqual({
      title: { code: "empty" },
    });
    expect(codes(createNoteInputSchema, { title: "", body: "" })).toEqual({
      title: { code: "empty" },
    });
    expect(codes(createNoteInputSchema, { body: "" })).toEqual({ title: { code: "required" } });
    expect(codes(createNoteInputSchema, { title: null, body: "" })).toEqual({
      title: { code: "required" },
    });
  });

  it("have length limits of 200 and 120", () => {
    expect(noteTitleSchema.safeParse("x".repeat(200)).success).toBe(true);
    expect(codes(createNoteInputSchema, { title: "x".repeat(201), body: "" })).toEqual({
      title: { code: "too_long", params: { max: 200 } },
    });
    expect(folderNameSchema.safeParse("x".repeat(121)).success).toBe(false);
  });
});

describe("note inputs", () => {
  it("limit the body to 1 MB of UTF-8", () => {
    const fits = "a".repeat(NOTE_BODY_MAX_BYTES);
    expect(createNoteInputSchema.safeParse({ title: "t", body: fits }).success).toBe(true);
    const over = "ä".repeat(NOTE_BODY_MAX_BYTES / 2 + 1);
    expect(codes(createNoteInputSchema, { title: "t", body: over })).toEqual({
      body: { code: "too_long", params: { maxBytes: NOTE_BODY_MAX_BYTES } },
    });
  });

  it("default the folder to the root level and drop a blank reason", () => {
    expect(createNoteInputSchema.parse({ title: "t", body: "", reason: "  " })).toEqual({
      folderId: null,
      title: "t",
      body: "",
      reason: undefined,
    });
  });

  it("need a version and something to change", () => {
    expect(codes(updateNoteInputSchema, { body: "x" })).toMatchObject({
      expectedVersion: { code: "required" },
    });
    expect(codes(updateNoteInputSchema, { expectedVersion: 1 })).toEqual({
      title: { code: "required" },
    });
    expect(codes(updateNoteInputSchema, { expectedVersion: 1.5, body: "" })).toMatchObject({
      expectedVersion: { code: "invalid_type" },
    });
    expect(
      replaceSectionInputSchema.parse({ expectedVersion: 2, heading: "A", body: "" }),
    ).toMatchObject({ includeSubsections: true });
  });

  it("need a section for the section view", () => {
    expect(codes(noteViewQuerySchema, { view: "section" })).toEqual({
      section: { code: "required" },
    });
    expect(noteViewQuerySchema.parse({ subsections: "false" })).toEqual({
      view: "full",
      subsections: false,
    });
  });
});

describe("token inputs", () => {
  it("build the mcpServers block", () => {
    expect(mcpServersConfig("https://wiki.example.com/mcp", "hmk_x")).toEqual({
      mcpServers: {
        hexmark: {
          type: "http",
          url: "https://wiki.example.com/mcp",
          headers: { Authorization: "Bearer hmk_x" },
        },
      },
    });
  });
});

describe("MCP tool inputs", () => {
  it("use snake_case names and the same rules as the HTTP inputs", () => {
    const inputs = mcpToolInputs.replace_section;
    expect(Object.keys(inputs)).toEqual([
      "note",
      "expected_version",
      "section",
      "body",
      "include_subsections",
      "reason",
    ]);
    expect(inputs.expected_version.safeParse(0).success).toBe(false);
    expect(mcpToolInputs.create_note.title.safeParse("a/b").success).toBe(false);
    expect(mcpToolInputs.create_note.reason.parse(" ")).toBeUndefined();
  });
});

describe("trash inputs", () => {
  it("restore a note where it was, into a folder, or to the root level", () => {
    expect(restoreNoteInputSchema.parse({})).toEqual({});
    expect(restoreNoteInputSchema.parse({ folderId: null, reason: "  " })).toEqual({
      folderId: null,
    });
    const id = "5d9e1f27-8c4b-4a3e-b7d2-6f0a1c8e9b53";
    expect(restoreNoteInputSchema.parse({ folderId: id }).folderId).toBe(id);
    expect(codes(restoreNoteInputSchema, { folderId: "nope" })).toEqual({
      folderId: { code: "invalid_format" },
    });
  });

  it("list the trash with a default limit of 50, at most 500", () => {
    expect(trashQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(trashQuerySchema.parse({ limit: "500" }).limit).toBe(500);
    expect(codes(trashQuerySchema, { limit: "501" })).toEqual({
      limit: { code: "too_long", params: { max: 500 } },
    });
  });

  it("keep 28 days by default, 1 to 3650", () => {
    expect(TRASH_RETENTION_DAYS).toEqual({ default: 28, min: 1, max: 3650 });
  });

  it("take ids only in the MCP restore tools; folder_id may be null for the root level", () => {
    const restore = mcpToolInputs.restore_note;
    expect(restore.note_id.safeParse("Projects/Plan").success).toBe(false);
    expect(restore.folder_id.safeParse(null).success).toBe(true);
    expect(restore.folder_id.safeParse(undefined).success).toBe(true);
    expect(mcpToolInputs.restore_folder.folder_id.safeParse("x").success).toBe(false);
  });
});
