import { describe, expect, it } from "vitest";
import { sliceCodePoints } from "../../../apps/server/src/lib/code-points";
import { approxTokens, parseSections } from "../../../apps/server/src/services/notes/sections";

// The section parser: which lines are headings (CommonMark), how sections
// nest, their paths, offsets and sizes.

function outline(body: string) {
  return parseSections(body).map((s) => [s.level, s.path, s.parentPosition]);
}

// Each section's own text and its text with subsections, cut by its offsets.
function texts(body: string) {
  return parseSections(body).map((s) => ({
    own: sliceCodePoints(body, s.startOffset, s.endOffset),
    subtree: sliceCodePoints(body, s.startOffset, s.subtreeEndOffset),
  }));
}

describe("headings", () => {
  it("makes one introduction section of a body without headings", () => {
    expect(outline("Just text.\n\nMore text.")).toEqual([[0, "(introduction)", null]]);
    expect(parseSections("")).toMatchObject([
      { level: 0, startOffset: 0, endOffset: 0, characters: 0, approxTokens: 0 },
    ]);
  });

  it("has no introduction when the body starts with a heading or only blank lines precede it", () => {
    expect(outline("# A\ntext")).toEqual([[1, "A", null]]);
    expect(outline("\n\n  \n# A\n")).toEqual([[1, "A", null]]);
    expect(outline("Before\n# A\n")).toEqual([
      [0, "(introduction)", null],
      [1, "A", null],
    ]);
  });

  it("handles a body of headings only", () => {
    expect(outline("# A\n## B\n### C\n# D")).toEqual([
      [1, "A", null],
      [2, "A > B", 0],
      [3, "A > B > C", 1],
      [1, "D", null],
    ]);
  });

  it("nests skipped levels under the nearest higher heading", () => {
    expect(outline("# A\n### Deep\n## Mid\n#### Deeper\n")).toEqual([
      [1, "A", null],
      [3, "A > Deep", 0],
      [2, "A > Mid", 0],
      [4, "A > Mid > Deeper", 2],
    ]);
    expect(outline("### Start deep\n# Top\n")).toEqual([
      [3, "Start deep", null],
      [1, "Top", null],
    ]);
  });

  it("numbers repeated paths, ignoring case, and uses them for subsections", () => {
    expect(outline("# Notes\n## Item\n## item\n# Notes\n## Item\n")).toEqual([
      [1, "Notes", null],
      [2, "Notes > Item", 0],
      [2, "Notes > item (2)", 0],
      [1, "Notes (2)", null],
      [2, "Notes (2) > Item", 3],
    ]);
  });

  it("never gives a heading the introduction's path", () => {
    expect(outline("# (introduction)\n")).toEqual([[1, "(introduction) (2)", null]]);
  });

  it("ignores # inside fenced and indented code, HTML blocks, lists and quotes", () => {
    const body = [
      "# Real",
      "```",
      "# not a heading",
      "```",
      "~~~md",
      "## nor this",
      "~~~",
      "    # indented code",
      "<div>",
      "# html",
      "</div>",
      "",
      "> # quoted",
      "- # in a list",
      "#hashtag is text",
      "\\# escaped",
    ].join("\n");
    expect(outline(body)).toEqual([[1, "Real", null]]);
  });

  it("recognises Setext headings, also over several lines", () => {
    expect(outline("Title\n=====\ntext\n\nSub\nline\n---\nmore")).toEqual([
      [1, "Title", null],
      [2, "Title > Sub line", 0],
    ]);
    expect(texts("Title\n=====\ntext\n")[0]?.own).toBe("Title\n=====\ntext\n");
  });

  it("keeps the heading text as written, white space collapsed, and names empty ones", () => {
    const [first, second, third] = parseSections("#   Use `pnpm`  *now*  ##\n#\n## Tabs\there\n");
    expect(first).toMatchObject({ heading: "Use `pnpm` *now*", path: "Use `pnpm` *now*" });
    expect(second).toMatchObject({ heading: "", path: "(untitled)" });
    expect(third).toMatchObject({ heading: "Tabs here", path: "(untitled) > Tabs here" });
  });
});

describe("ranges", () => {
  it("starts at the heading's line and ends at the next heading; subtrees span children", () => {
    const body = "Intro\n# A\na\n## B\nb\n# C\nc";
    expect(texts(body)).toEqual([
      { own: "Intro\n", subtree: "Intro\n" },
      { own: "# A\na\n", subtree: "# A\na\n## B\nb\n" },
      { own: "## B\nb\n", subtree: "## B\nb\n" },
      { own: "# C\nc", subtree: "# C\nc" },
    ]);
  });

  it("includes indentation before a heading in the heading's line", () => {
    expect(texts("x\n   # Indented\ny")[1]?.own).toBe("   # Indented\ny");
  });

  it("keeps CRLF line endings inside the ranges", () => {
    const body = "Intro\r\n# A\r\ntext\r\n## B\r\nmore\r\n";
    expect(outline(body)).toEqual([
      [0, "(introduction)", null],
      [1, "A", null],
      [2, "A > B", 1],
    ]);
    expect(texts(body).map((t) => t.own)).toEqual([
      "Intro\r\n",
      "# A\r\ntext\r\n",
      "## B\r\nmore\r\n",
    ]);
  });

  it("counts offsets and characters in code points and tokens in UTF-8 bytes", () => {
    const body = "😀😀\n# Ü\nä😀\n";
    const [intro, heading] = parseSections(body);
    expect(intro).toMatchObject({ startOffset: 0, endOffset: 3, characters: 3 });
    // "😀😀\n" is 9 bytes.
    expect(intro?.approxTokens).toBe(3);
    // "# Ü\nä😀\n": 2 + 2 + 1 + 2 + 4 + 1 = 12 bytes, 7 code points.
    expect(heading).toMatchObject({ startOffset: 3, endOffset: 10, characters: 7 });
    expect(heading?.approxTokens).toBe(3);
    expect(texts(body)[1]?.own).toBe("# Ü\nä😀\n");
  });

  it("sizes a section with its subsections and keeps its own size apart", () => {
    const body = `# A\n${"x".repeat(40)}\n## B\n${"y".repeat(400)}\n`;
    const [a, b] = parseSections(body);
    expect(a?.approxTokens).toBe(approxTokens(body));
    expect(a?.ownApproxTokens).toBe(approxTokens(`# A\n${"x".repeat(40)}\n`));
    expect(b?.approxTokens).toBe(b?.ownApproxTokens);
  });

  it("gives the search text without the heading line", () => {
    const [, a] = parseSections("Intro words\n# Heading words\nbody words\n");
    expect(a?.searchText).toBe("\nbody words\n");
    expect(parseSections("Intro words\n# H")[0]?.searchText).toBe("Intro words\n");
  });

  it("parses a large body with many headings quickly", () => {
    const body = Array.from({ length: 5000 }, (_, i) => `## H${i}\ntext ${i}\n`).join("");
    const started = Date.now();
    const sections = parseSections(body);
    expect(sections).toHaveLength(5000);
    expect(sections.at(-1)?.subtreeEndOffset).toBe(body.length);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
