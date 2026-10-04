import { describe, expect, it } from "vitest";
import {
  findSection,
  sectionMissRefusal,
} from "../../../apps/server/src/services/notes/section-lookup";
import { parseSections } from "../../../apps/server/src/services/notes/sections";

// Finding a section by the end of its path (section-lookup.ts): order of the
// rules, repeated headings, case, and what is ambiguous or not found.

const body = [
  "# Naming",
  "## Rule",
  "## Parts",
  "### Apps",
  "### Libraries",
  "## Examples",
  "one",
  "## Examples",
  "two",
  "# Other",
  "## Parts",
  "### Tools",
  "",
].join("\n");
const sections = parseSections(body);

const found = (query: string) => {
  const match = findSection(sections, query);
  return "found" in match ? match.found.path : match;
};

describe("path ends", () => {
  it("lists the paths it works on", () => {
    expect(sections.map((section) => section.path)).toEqual([
      "Naming",
      "Naming > Rule",
      "Naming > Parts",
      "Naming > Parts > Apps",
      "Naming > Parts > Libraries",
      "Naming > Examples",
      "Naming > Examples (2)",
      "Other",
      "Other > Parts",
      "Other > Parts > Tools",
    ]);
  });

  it("matches the end of a path in whole headings, ignoring case", () => {
    expect(found("Parts > Apps")).toBe("Naming > Parts > Apps");
    expect(found("parts > apps")).toBe("Naming > Parts > Apps");
    expect(found("APPS")).toBe("Naming > Parts > Apps");
    expect(found("Tools")).toBe("Other > Parts > Tools");
    expect(found("Rule")).toBe("Naming > Rule");
    // The suffixed path of a repeated heading names that one section.
    expect(found("Examples (2)")).toBe("Naming > Examples (2)");
    expect(found("naming > examples (2)")).toBe("Naming > Examples (2)");
  });

  it("does not match inside a heading", () => {
    expect(found("pps")).toMatchObject({ error: "section_not_found" });
    expect(found("arts > Apps")).toMatchObject({ error: "section_not_found" });
  });

  it("prefers the exact path, then the path ignoring case, over an end", () => {
    // "Naming > Examples" is the first section's full path, although the
    // second one's headings read the same.
    expect(found("Naming > Examples")).toBe("Naming > Examples");
    expect(found("naming > EXAMPLES")).toBe("Naming > Examples");
    expect(found("Other")).toBe("Other");
  });

  it("reports a heading that occurs twice as ambiguous, with both paths", () => {
    expect(findSection(sections, "Examples")).toEqual({
      error: "ambiguous_section",
      candidates: ["Naming > Examples", "Naming > Examples (2)"],
    });
  });

  it("reports an end that fits several sections as ambiguous", () => {
    expect(findSection(sections, "parts")).toEqual({
      error: "ambiguous_section",
      candidates: ["Naming > Parts", "Other > Parts"],
    });
  });

  it("lists the note's paths when nothing matches", () => {
    expect(findSection(sections, "Nope")).toEqual({
      error: "section_not_found",
      paths: sections.map((section) => section.path),
    });
  });

  it("refuses a miss with the section as requested, next to candidates or paths", () => {
    const ambiguous = findSection(sections, " parts");
    if ("found" in ambiguous) throw new Error("expected a miss");
    expect(sectionMissRefusal(ambiguous, " parts")).toEqual({
      ok: false,
      status: 409,
      error: "ambiguous_section",
      details: { section: " parts", candidates: ["Naming > Parts", "Other > Parts"] },
    });
    const missing = findSection(sections, "Nope");
    if ("found" in missing) throw new Error("expected a miss");
    expect(sectionMissRefusal(missing, "Nope")).toMatchObject({
      status: 404,
      error: "section_not_found",
      details: { section: "Nope", paths: sections.map((section) => section.path) },
    });
  });

  it("finds the introduction and untitled headings", () => {
    const other = parseSections("Intro\n# A\n##\ntext\n");
    expect(other.map((section) => section.path)).toEqual(["(introduction)", "A", "A > (untitled)"]);
    expect(findSection(other, "(introduction)")).toMatchObject({ found: { level: 0 } });
    expect(findSection(other, "(untitled)")).toMatchObject({ found: { path: "A > (untitled)" } });
  });

  it("keeps a heading containing the separator whole", () => {
    const tricky = parseSections("# A > B\n## C\n# B\n");
    expect(findSection(tricky, "A > B > C")).toMatchObject({ found: { path: "A > B > C" } });
    expect(findSection(tricky, "C")).toMatchObject({ found: { path: "A > B > C" } });
    // "B" is only part of the heading "A > B" there.
    expect(findSection(tricky, "B > C")).toMatchObject({ error: "section_not_found" });
    expect(findSection(tricky, "B")).toMatchObject({ found: { path: "B" } });
  });
});
