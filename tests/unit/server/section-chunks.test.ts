import { describe, expect, it } from "vitest";
import { revisionSectionPath } from "../../../apps/server/src/services/notes/revision-section-path";
import { textChunk } from "../../../apps/server/src/services/notes/section-chunks";

// Reading a section in pieces (section-chunks.ts) and the section path a
// revision records (revision-section-path.ts).

describe("reading in pieces", () => {
  const text = "line one\nline two\nline three\n";

  it("returns the whole text without a limit", () => {
    expect(textChunk(text)).toEqual({
      text,
      offset: 0,
      returned: 29,
      total: 29,
      hasMore: false,
      nextOffset: null,
    });
  });

  it("cuts after the last line break inside the limit", () => {
    const first = textChunk(text, 0, 15);
    expect(first).toEqual({
      text: "line one\n",
      offset: 0,
      returned: 9,
      total: 29,
      hasMore: true,
      nextOffset: 9,
    });
    const second = textChunk(text, 9, 15);
    expect(second).toMatchObject({ text: "line two\n", hasMore: true, nextOffset: 18 });
    const last = textChunk(text, 18, 15);
    expect(last).toMatchObject({ text: "line three\n", hasMore: false, nextOffset: null });
  });

  it("puts the pieces back together to the whole text", () => {
    const long = Array.from({ length: 40 }, (_, i) => `row ${i} ${"x".repeat(i % 7)}`).join("\n");
    let offset: number | null = 0;
    let joined = "";
    let pieces = 0;
    while (offset !== null) {
      const piece = textChunk(long, offset, 50);
      joined += piece.text;
      offset = piece.nextOffset;
      pieces += 1;
    }
    expect(joined).toBe(long);
    expect(pieces).toBeGreaterThan(5);
  });

  it("cuts inside a line only when one line is longer than the limit", () => {
    expect(textChunk("abcdefghij\nk\n", 0, 4)).toMatchObject({
      text: "abcd",
      returned: 4,
      nextOffset: 4,
    });
  });

  it("counts code points, so an emoji is one character and never split", () => {
    const emoji = "😀😀😀\n😀\n";
    expect(textChunk(emoji, 0, 2)).toMatchObject({ text: "😀😀", returned: 2, total: 6 });
    expect(textChunk(emoji, 4, 10)).toMatchObject({ text: "😀\n", offset: 4, hasMore: false });
  });

  it("gives an empty piece at or past the end, with a note saying so", () => {
    expect(textChunk(text, 29, 10)).toMatchObject({
      text: "",
      offset: 29,
      returned: 0,
      notice: "offset is at the end (total 29); nothing is left to read.",
    });
    expect(textChunk(text, 500)).toMatchObject({
      text: "",
      offset: 29,
      requestedOffset: 500,
      hasMore: false,
      notice: "offset is past the end (total 29); nothing is left to read.",
    });
  });

  it("names the requested offset only when it was moved back to the end", () => {
    expect(textChunk(text, 30).requestedOffset).toBe(30);
    expect(textChunk(text, 29)).not.toHaveProperty("requestedOffset");
    expect(textChunk(text, 5, 3)).not.toHaveProperty("requestedOffset");
    expect(textChunk("", 0)).not.toHaveProperty("requestedOffset");
    expect(textChunk("", 4)).toMatchObject({ offset: 0, requestedOffset: 4 });
  });

  it("adds no notice to a piece with text, nor to an empty section read from its start", () => {
    expect(textChunk(text, 0, 10).notice).toBeUndefined();
    expect(textChunk(text, 28).notice).toBeUndefined();
    expect(textChunk("", 0).notice).toBeUndefined();
  });

  it("cuts inside a line when the limit is shorter than the line, and goes on from there", () => {
    const line = "## A long heading line\nnext\n";
    expect(textChunk(line, 0, 5)).toMatchObject({ text: "## A ", nextOffset: 5, hasMore: true });
    expect(textChunk(line, 5, 30)).toMatchObject({ text: "long heading line\nnext\n" });
  });
});

describe("section path of a revision", () => {
  it("keeps a path up to 1000 characters as it is", () => {
    const path = `${"a".repeat(995)} > b`;
    expect(revisionSectionPath(path)).toBe(path);
    expect(revisionSectionPath("Setup > Docker")).toBe("Setup > Docker");
  });

  it("keeps the end of a longer path, cut at a heading, behind '… > '", () => {
    const path = Array.from({ length: 30 }, (_, i) => `Heading ${i} ${"h".repeat(40)}`).join(" > ");
    const kept = revisionSectionPath(path);
    expect(Array.from(kept).length).toBeLessThanOrEqual(1000);
    expect(kept.startsWith("… > Heading ")).toBe(true);
    expect(path.endsWith(kept.slice(4))).toBe(true);
    expect(kept.endsWith(`Heading 29 ${"h".repeat(40)}`)).toBe(true);
  });

  it("cuts inside a last heading that alone is too long, behind '…'", () => {
    const path = `Top > ${"ä".repeat(1200)}`;
    const kept = revisionSectionPath(path);
    expect(Array.from(kept)).toHaveLength(1000);
    expect(kept).toBe(`…${"ä".repeat(999)}`);
  });
});
