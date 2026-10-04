import { INTRODUCTION_SECTION_PATH, SECTION_PATH_SEPARATOR, utf8Length } from "@hexmark/shared";
import type { Heading, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toCodePointOffsets } from "../../lib/code-points";

// Splits a note's Markdown body into sections (note_sections). The body is
// parsed as CommonMark, so headings inside code blocks, HTML blocks or
// indented code are not headings. Only top-level headings count: a heading
// inside a list item or block quote belongs to the surrounding section.
//
// Sections:
// - level 0, path "(introduction)": the text before the first heading; only
//   when it is not blank, or when the body has no heading at all.
// - one per ATX (`## x`) or Setext (`x` + `===`/`---`) heading. A section
//   starts at the beginning of its heading's line and ends where the next
//   heading's line starts; its subtree ends at the next heading of the same or
//   a higher level. Levels may skip (# then ###): the parent is the nearest
//   heading before it with a lower level.
// - path: the parent's path + " > " + the heading text (white space collapsed;
//   "(untitled)" for an empty heading). A path that already exists in the note
//   (ignoring case) gets " (2)", " (3)", ...; subsections use the suffixed path.
//
// Offsets are Unicode code points (PostgreSQL counts the same way).
// `characters` (code points) and `approxTokens` (UTF-8 bytes / 4, rounded up)
// cover the section including its subsections.

export interface ParsedSection {
  position: number;
  level: number;
  heading: string;
  path: string;
  parentPosition: number | null;
  startOffset: number;
  endOffset: number;
  subtreeEndOffset: number;
  characters: number;
  approxTokens: number;
  // The section's own text without its subsections, estimated the same way.
  ownApproxTokens: number;
  // Text for the section's search vector without the heading line.
  searchText: string;
}

// Path segment of a heading without text.
export const UNTITLED = "(untitled)";

export function approxTokens(text: string): number {
  return Math.ceil(utf8Length(text) / 4);
}

interface RawHeading {
  level: number;
  text: string;
  // Code unit offsets: start of the heading's line, end of the heading.
  lineStart: number;
  headingEnd: number;
}

function headingText(body: string, node: Heading): string {
  const first = node.children[0]?.position?.start.offset;
  const last = node.children.at(-1)?.position?.end.offset;
  if (first === undefined || last === undefined) return "";
  return body.slice(first, last).replace(/\s+/g, " ").trim();
}

function rawHeadings(body: string): RawHeading[] {
  const tree = fromMarkdown(body);
  return tree.children
    .filter((node: RootContent): node is Heading => node.type === "heading")
    .map((node) => {
      const start = node.position?.start.offset ?? 0;
      return {
        level: node.depth,
        text: headingText(body, node),
        lineStart: body.lastIndexOf("\n", start - 1) + 1,
        headingEnd: node.position?.end.offset ?? start,
      };
    });
}

class PathRegistry {
  private readonly taken = new Set<string>();

  claim(path: string): string {
    let candidate = path;
    for (let n = 2; this.taken.has(candidate.toLowerCase()); n++) candidate = `${path} (${n})`;
    this.taken.add(candidate.toLowerCase());
    return candidate;
  }
}

interface Range {
  level: number;
  heading: string;
  // Code unit offsets.
  start: number;
  end: number;
  subtreeEnd: number;
  textStart: number;
  parentIndex: number | null;
}

function ranges(body: string, headings: RawHeading[]): Range[] {
  const result: Range[] = [];
  const firstStart = headings[0]?.lineStart ?? body.length;
  if (headings.length === 0 || body.slice(0, firstStart).trim() !== "") {
    result.push({
      level: 0,
      heading: "",
      start: 0,
      end: firstStart,
      subtreeEnd: firstStart,
      textStart: 0,
      parentIndex: null,
    });
  }
  const offset = result.length;
  // Open headings, innermost last; a heading closes (its subtree ends) at the
  // next heading of the same or a higher level.
  const stack: number[] = [];
  headings.forEach((heading, i) => {
    while (stack.length > 0 && (headings[stack.at(-1) as number]?.level ?? 0) >= heading.level) {
      const closed = result[(stack.pop() as number) + offset];
      if (closed) closed.subtreeEnd = heading.lineStart;
    }
    const parent = stack.at(-1);
    const end = headings[i + 1]?.lineStart ?? body.length;
    result.push({
      level: heading.level,
      heading: heading.text,
      start: heading.lineStart,
      end,
      subtreeEnd: body.length,
      textStart: Math.min(heading.headingEnd, end),
      parentIndex: parent === undefined ? null : parent + offset,
    });
    stack.push(i);
  });
  return result;
}

export function parseSections(body: string): ParsedSection[] {
  const list = ranges(body, rawHeadings(body));
  const units = list.flatMap((range) => [range.start, range.end, range.subtreeEnd]);
  const points = toCodePointOffsets(body, units);
  const registry = new PathRegistry();
  // Reserved even without an introduction, so a heading of that name never
  // takes the introduction's path.
  registry.claim(INTRODUCTION_SECTION_PATH);
  const paths: string[] = [];
  return list.map((range, position) => {
    const parentPath = range.parentIndex === null ? null : paths[range.parentIndex];
    const segment = range.heading || UNTITLED;
    const path =
      range.level === 0
        ? INTRODUCTION_SECTION_PATH
        : registry.claim(parentPath ? `${parentPath}${SECTION_PATH_SEPARATOR}${segment}` : segment);
    paths.push(path);
    const subtree = body.slice(range.start, range.subtreeEnd);
    const [start, end, subtreeEnd] = points.slice(position * 3, position * 3 + 3) as [
      number,
      number,
      number,
    ];
    return {
      position,
      level: range.level,
      heading: range.heading,
      path,
      parentPosition: range.parentIndex,
      startOffset: start,
      endOffset: end,
      subtreeEndOffset: subtreeEnd,
      characters: subtreeEnd - start,
      approxTokens: approxTokens(subtree),
      ownApproxTokens: approxTokens(body.slice(range.start, range.end)),
      searchText: body.slice(range.textStart, range.end),
    };
  });
}
