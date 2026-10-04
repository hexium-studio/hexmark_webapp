import { MCP_TOOLS } from "@hexmark/shared/mcp";
import { describe, expect, it } from "vitest";
import { errorResult } from "../../../apps/server/src/mcp/results";
import { callTool, defineTool } from "../../../apps/server/src/mcp/tool-registry";

// Invalid MCP arguments as Hexmark errors (tool-registry.ts, input-rules.ts):
// code, params and an English rule per field, derived from the schema the
// tool announces.

type Fields = Record<string, { code: string; params?: object; rule: string }>;

async function refusal(name: keyof typeof MCP_TOOLS, args: unknown) {
  let ran = false;
  const tool = defineTool(MCP_TOOLS[name] as never, async () => {
    ran = true;
    return { content: [] };
  });
  const result = await callTool(tool, args);
  const text = (result.content[0] as { text?: string } | undefined)?.text ?? "{}";
  return { ran, isError: result.isError, body: JSON.parse(text) as { fields?: Fields } };
}

describe("invalid arguments", () => {
  it("answer invalid_input with a rule per field and never run the tool", async () => {
    const answer = await refusal("create_note", { title: "a/b", body: "" });
    expect(answer).toMatchObject({ ran: false, isError: true });
    expect(answer.body).toEqual({
      error: "invalid_input",
      message: expect.stringContaining("fields"),
      fields: {
        title: {
          code: "invalid_format",
          rule: "title must not contain '/' or control characters such as line breaks and tabs",
        },
      },
    });
  });

  it("tell an empty or blank value from a missing one", async () => {
    for (const title of ["", "   "]) {
      const { body } = await refusal("create_note", { title, body: "x" });
      expect(body.fields?.title).toEqual({ code: "empty", rule: "title must not be empty" });
    }
    const missing = await refusal("create_note", { body: "x" });
    expect(missing.body.fields?.title).toEqual({ code: "required", rule: "title is required" });
  });

  it("name types, formats and bounds from the announced schema", async () => {
    const section = await refusal("read_section", {
      note: 7,
      section: " ",
      include_subsections: "yes",
      offset: -1,
      limit: 1.5,
    });
    expect(section.body.fields).toEqual({
      note: { code: "invalid_type", rule: "note must be a string" },
      section: { code: "empty", rule: "section must not be empty" },
      include_subsections: {
        code: "invalid_type",
        rule: "include_subsections must be true or false",
      },
      offset: { code: "invalid", rule: "offset must be at least 0" },
      limit: { code: "invalid_type", rule: "limit must be a whole number" },
    });
    const listing = await refusal("list_folder", { folder_id: "nope", depth: 11 });
    expect(listing.body.fields).toEqual({
      folder_id: { code: "invalid_format", rule: "folder_id must be a UUID" },
      depth: { code: "too_long", params: { max: 10 }, rule: "depth must be at most 10" },
    });
    const move = await refusal("move_note", { note: "x", expected_version: 0, folder_id: "x" });
    expect(move.body.fields).toEqual({
      expected_version: { code: "invalid", rule: "expected_version must be at least 1" },
      folder_id: { code: "invalid_format", rule: "folder_id must be a UUID or null" },
    });
    const changes = await refusal("list_changes", { since: "soon" });
    expect(changes.body.fields?.since?.rule).toBe(
      "since must be an ISO 8601 date-time with time zone, e.g. 2026-10-01T00:00:00Z",
    );
    const long = await refusal("create_folder", { name: "n".repeat(121) });
    expect(long.body.fields?.name?.rule).toBe("name must be at most 120 characters");
  });

  it("let valid arguments through to the tool", async () => {
    const valid = await refusal("read_section", {
      note: "Plan",
      section: "A",
      offset: 0,
      limit: 5,
    });
    expect(valid.ran).toBe(true);
  });

  it("answer a field refusal of the service as invalid_input too", () => {
    const result = errorResult("validation", {
      fields: { body: { code: "too_long", params: { maxBytes: 1048576 } } },
    });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({
      error: "invalid_input",
      fields: {
        body: {
          code: "too_long",
          params: { maxBytes: 1048576 },
          rule: "body must keep the note within 1048576 bytes (UTF-8)",
        },
      },
    });
  });
});
