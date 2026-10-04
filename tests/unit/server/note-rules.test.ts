import { describe, expect, it } from "vitest";
import {
  countCodePoints,
  sliceCodePoints,
  toCodePointOffsets,
  toCodeUnitOffsets,
} from "../../../apps/server/src/lib/code-points";
import {
  beyondRole,
  effectivePermissions,
} from "../../../apps/server/src/services/access/note-permissions";
import { parseNoteAddress } from "../../../apps/server/src/services/notes/addressing";
import {
  findSection,
  replaceSectionText,
  sectionText,
  separatorBefore,
} from "../../../apps/server/src/services/notes/section-lookup";
import { parseSections } from "../../../apps/server/src/services/notes/sections";

// Pure rules of the notes core: addressing, permissions, finding and
// replacing sections, code point offsets.

describe("note addresses", () => {
  it("reads ids, titles and folder paths", () => {
    const id = "3F2504E0-4F89-41D3-9A0C-0305E82C3301";
    expect(parseNoteAddress(id)).toEqual({ kind: "id", id: id.toLowerCase() });
    expect(parseNoteAddress(" Naming ")).toEqual({ kind: "path", folders: null, title: "Naming" });
    expect(parseNoteAddress("Projects / Web/Naming")).toEqual({
      kind: "path",
      folders: ["Projects", "Web"],
      title: "Naming",
    });
    expect(parseNoteAddress("/Root note")).toEqual({
      kind: "path",
      folders: [],
      title: "Root note",
    });
  });
});

describe("permissions", () => {
  it("intersects the role with the token's permissions", () => {
    expect(effectivePermissions("admin", null)).toEqual([
      "read",
      "search",
      "create",
      "edit",
      "move",
      "delete",
      "lock",
    ]);
    expect(effectivePermissions("guest", null)).toEqual(["read", "search"]);
    expect(effectivePermissions("user", ["edit", "read"])).toEqual(["read", "edit"]);
    expect(effectivePermissions("guest", ["read", "edit"])).toEqual(["read"]);
    expect(effectivePermissions("guest", ["edit"])).toEqual([]);
  });

  it("names the permissions a role cannot grant", () => {
    expect(beyondRole("guest", ["read", "edit", "move"])).toEqual(["edit", "move"]);
    expect(beyondRole("user", ["lock"])).toEqual([]);
  });
});

describe("finding sections", () => {
  const sections = parseSections("# Setup\n## Docker\n# Usage\n## docker\n## Only here\n");

  it("matches the exact path, then ignoring case, then a unique last heading", () => {
    expect(findSection(sections, "Usage > docker")).toMatchObject({
      found: { path: "Usage > docker" },
    });
    expect(findSection(sections, "setup > DOCKER")).toMatchObject({
      found: { path: "Setup > Docker" },
    });
    expect(findSection(sections, "only here")).toMatchObject({
      found: { path: "Usage > Only here" },
    });
  });

  it("reports a heading several sections end with, and unknown paths", () => {
    expect(findSection(sections, "Docker")).toEqual({
      error: "ambiguous_section",
      candidates: ["Setup > Docker", "Usage > docker"],
    });
    expect(findSection(sections, "Nope")).toMatchObject({
      error: "section_not_found",
      paths: ["Setup", "Setup > Docker", "Usage", "Usage > docker", "Usage > Only here"],
    });
  });
});

describe("replacing sections", () => {
  const body = "Intro 😀\n# A\na\n## B\nb\n# C\nc\n";
  const [intro, a, b, c] = parseSections(body);

  it("replaces a section with or without its subsections", () => {
    if (!a || !b) throw new Error("missing sections");
    expect(replaceSectionText(body, a, true, "# A\nnew\n\n")).toBe(
      "Intro 😀\n# A\nnew\n\n# C\nc\n",
    );
    expect(replaceSectionText(body, a, false, "# A\nnew\n\n")).toBe(
      "Intro 😀\n# A\nnew\n\n## B\nb\n# C\nc\n",
    );
  });

  it("replaces the introduction and the last section, and can remove a section", () => {
    if (!intro || !c || !b) throw new Error("missing sections");
    expect(replaceSectionText(body, intro, true, "Hi\n\n")).toBe("Hi\n\n# A\na\n## B\nb\n# C\nc\n");
    expect(replaceSectionText(body, c, true, "# C\nend")).toBe(
      "Intro 😀\n# A\na\n## B\nb\n# C\nend",
    );
    expect(replaceSectionText(body, b, true, "")).toBe("Intro 😀\n# A\na\n# C\nc\n");
  });

  it("adds the blank line before a following heading when the text lacks it", () => {
    if (!a || !b || !c) throw new Error("missing sections");
    // No line break, one line break, CRLF: completed to a blank line.
    expect(replaceSectionText(body, b, true, "## B2")).toBe("Intro 😀\n# A\na\n## B2\n\n# C\nc\n");
    expect(replaceSectionText(body, b, true, "## B2\n")).toBe(
      "Intro 😀\n# A\na\n## B2\n\n# C\nc\n",
    );
    expect(replaceSectionText(body, b, true, "## B2\r\nx\r\n")).toBe(
      "Intro 😀\n# A\na\n## B2\r\nx\r\n\r\n# C\nc\n",
    );
    // A blank line (also one holding spaces) is kept as it is.
    expect(replaceSectionText(body, b, true, "## B2\n  \n")).toBe(
      "Intro 😀\n# A\na\n## B2\n  \n# C\nc\n",
    );
    // Nothing follows the last section: nothing is added; nor to an empty text.
    expect(replaceSectionText(body, c, true, "# C\nend\n")).toBe(
      "Intro 😀\n# A\na\n## B\nb\n# C\nend\n",
    );
    expect(replaceSectionText(body, b, true, "")).toBe("Intro 😀\n# A\na\n# C\nc\n");
    expect(separatorBefore("x", "")).toBe("");
    expect(separatorBefore("x", "# Next")).toBe("\n\n");
    expect(separatorBefore("x\n\n", "# Next")).toBe("");
  });

  it("reads back exactly what replacing with the same text keeps", () => {
    for (const section of [intro, a, b, c]) {
      if (!section) throw new Error("missing section");
      for (const sub of [true, false]) {
        const text = sectionText(body, section, sub);
        expect(replaceSectionText(body, section, sub, text)).toBe(body);
      }
    }
  });
});

describe("code points", () => {
  it("converts between UTF-16 units and code points both ways", () => {
    const text = "a😀b😀c";
    expect(toCodePointOffsets(text, [0, 1, 3, 4, 6, 7])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(toCodeUnitOffsets(text, [5, 0, 2])).toEqual([7, 0, 3]);
    expect(countCodePoints(text)).toBe(5);
    expect(sliceCodePoints(text, 1, 4)).toBe("😀b😀");
    expect(toCodeUnitOffsets(text, [99])).toEqual([7]);
  });
});
